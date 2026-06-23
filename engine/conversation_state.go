package engine

import (
	"fmt"
	"math/rand"
	"strings"
)

// ConversationState tracks per-session conversational state so prompts stay
// non-repetitive across long sessions. Faithful port of conversationState.ts.
type ConversationState struct {
	SessionID       string
	RoomID          string
	Turn            int
	TopicsDiscussed []string
	TopicTurnMap    map[string]int
	CurrentTopic    string
	RecentPhrases   []string
	PatientTone     string
	ClinicianTone   string
	ToneHistory     []string
	PatientMemories []string
	ClinicianShared []string
	FlaggedConcerns []string
	FollowUpDue     bool
	Phase           string
}

var topicWeights = map[string]int{
	"mood": 10, "anxiety": 9, "stress": 9, "relationships": 8, "work_life": 7,
	"coping_strategies": 8, "childhood": 6, "family_dynamics": 7, "grief_loss": 6,
	"self_esteem": 8, "boundaries": 6, "sleep": 6, "daily_routine": 5,
	"social_connections": 6, "goals_progress": 7, "fears": 7, "past_experiences": 5,
	"emotions": 9, "patterns_behaviors": 7,
}

// allTopics preserves a stable ordering for deterministic-ish weighted selection.
var allTopics = []string{
	"mood", "anxiety", "stress", "relationships", "work_life", "coping_strategies",
	"childhood", "family_dynamics", "grief_loss", "self_esteem", "boundaries",
	"sleep", "daily_routine", "social_connections", "goals_progress", "fears",
	"past_experiences", "emotions", "patterns_behaviors",
}

var fillerPhrases = []string{
	"i hear you", "i understand", "that must be", "that makes sense",
	"i can see that", "that sounds like", "absolutely", "certainly", "of course",
	"thank you for sharing", "i appreciate that", "that's wonderful", "that's great",
	"very insightful", "good point", "you're so right",
}

var toneTransitions = map[string][]string{
	"neutral":    {"cheerful", "tired", "nostalgic", "neutral"},
	"cheerful":   {"neutral", "nostalgic", "content", "cheerful"},
	"tired":      {"neutral", "frustrated", "lonely", "tired"},
	"nostalgic":  {"cheerful", "content", "neutral", "nostalgic"},
	"anxious":    {"neutral", "tired", "frustrated"},
	"content":    {"cheerful", "neutral", "nostalgic"},
	"frustrated": {"neutral", "tired", "anxious"},
	"lonely":     {"neutral", "nostalgic", "tired"},
}

var concernKeywords = []string{
	"hopeless", "worthless", "overwhelmed", "can't cope", "gave up", "scared",
	"worried", "panic", "depressed", "anxious", "alone", "crying", "can't sleep",
}

var memoryKeywords = []string{
	"remember", "used to", "back when", "years ago", "growing up", "as a child",
}

func createConversationState(sessionID, roomID string) *ConversationState {
	return &ConversationState{
		SessionID:       sessionID,
		RoomID:          roomID,
		Turn:            0,
		TopicsDiscussed: []string{},
		TopicTurnMap:    map[string]int{},
		CurrentTopic:    "",
		RecentPhrases:   []string{},
		PatientTone:     "neutral",
		ClinicianTone:   "neutral",
		ToneHistory:     []string{},
		PatientMemories: []string{},
		ClinicianShared: []string{},
		FlaggedConcerns: []string{},
		FollowUpDue:     false,
		Phase:           "opening",
	}
}

func (s *ConversationState) updatePhase() {
	switch {
	case s.Turn < 6:
		s.Phase = "opening"
	case s.Turn < 40:
		s.Phase = "main"
	case s.Turn < 100:
		s.Phase = "deep"
	default:
		s.Phase = "main"
	}
}

func (s *ConversationState) selectNextTopic() string {
	if s.FollowUpDue && len(s.FlaggedConcerns) > 0 {
		s.FollowUpDue = false
		if s.CurrentTopic != "" {
			return s.CurrentTopic
		}
		return "mood"
	}
	candidates := []string{}
	for _, t := range allTopics {
		if last, ok := s.TopicTurnMap[t]; ok && s.Turn-last < 10 {
			continue
		}
		candidates = append(candidates, t)
	}
	pool := candidates
	if len(pool) == 0 {
		pool = allTopics
	}
	total := 0
	for _, t := range pool {
		total += topicWeights[t]
	}
	r := rand.Float64() * float64(total)
	for _, t := range pool {
		r -= float64(topicWeights[t])
		if r <= 0 {
			return t
		}
	}
	return pool[0]
}

func evolveTone(current string) string {
	opts := toneTransitions[current]
	if len(opts) == 0 {
		return current
	}
	return opts[rand.Intn(len(opts))]
}

func (s *ConversationState) buildClinicianDirectives() string {
	var lines []string
	topic := s.selectNextTopic()
	s.CurrentTopic = topic
	lines = append(lines, fmt.Sprintf(`CURRENT FOCUS: Naturally steer toward "%s" this turn.`, strings.Replace(topic, "_", " ", 1)))

	var avoid []string
	for _, t := range allTopics {
		if last, ok := s.TopicTurnMap[t]; ok && s.Turn-last < 8 {
			avoid = append(avoid, t)
		}
	}
	if len(avoid) > 0 {
		lines = append(lines, fmt.Sprintf("AVOID these topics (discussed recently): %s.", strings.Join(avoid, ", ")))
	}

	banned := s.bannedFillerPhrases()
	if len(banned) > 0 {
		lines = append(lines, fmt.Sprintf(`DO NOT use these phrases (used too recently): "%s".`, strings.Join(banned, `", "`)))
	}

	s.ClinicianTone = evolveTone(s.ClinicianTone)
	lines = append(lines, fmt.Sprintf("YOUR TONE THIS TURN: %s — let it show subtly in word choice.", s.ClinicianTone))

	switch s.Phase {
	case "opening":
		lines = append(lines, "This is early in the session — build rapport and establish psychological safety.")
	case "deep":
		lines = append(lines, "You are deep into the session — explore underlying patterns and emotional themes.")
	case "closing":
		lines = append(lines, "The session is wrapping up — begin summarizing key insights and any takeaways.")
	}

	if len(s.FlaggedConcerns) > 0 && rand.Float64() < 0.3 {
		last := s.FlaggedConcerns[len(s.FlaggedConcerns)-1]
		lines = append(lines, fmt.Sprintf(`FOLLOW UP: Check back on "%s" — you mentioned it earlier.`, last))
		s.FollowUpDue = false
	}
	if s.Turn > 0 && s.Turn%5 == 0 {
		lines = append(lines, "Vary your sentence starter — do not begin with the same word as your last turn.")
	}
	if s.Turn > 0 && s.Turn%12 == 0 {
		lines = append(lines, "Offer a brief normalizing statement — gently remind the patient that their feelings are understandable.")
	}
	return strings.Join(lines, "\n")
}

func (s *ConversationState) buildPatientDirectives() string {
	var lines []string
	if s.Turn%8 == 0 {
		s.PatientTone = evolveTone(s.PatientTone)
	}
	lines = append(lines, fmt.Sprintf("YOUR MOOD THIS TURN: %s.", s.PatientTone))

	if len(s.PatientMemories) > 0 {
		start := 0
		if len(s.PatientMemories) > 5 {
			start = len(s.PatientMemories) - 5
		}
		lines = append(lines, fmt.Sprintf("Do NOT repeat these stories you already told: %s.", strings.Join(s.PatientMemories[start:], "; ")))
	}

	banned := s.bannedFillerPhrases()
	if len(banned) > 0 {
		lines = append(lines, fmt.Sprintf(`DO NOT use: "%s".`, strings.Join(banned, `", "`)))
	}

	if s.Turn > 4 && s.Turn%7 == 0 {
		lines = append(lines, "This turn, ask the therapist a question — seek their perspective or some validation.")
	}
	if s.Turn > 6 && s.Turn%11 == 0 {
		lines = append(lines, "Express a moment of resistance or difficulty — something you find hard to talk about or are not ready to face yet.")
	}
	if s.Turn > 8 && s.Turn%13 == 0 {
		lines = append(lines, "Share a small moment of self-awareness or progress — something you noticed about yourself this week.")
	}
	return strings.Join(lines, "\n")
}

func (s *ConversationState) bannedFillerPhrases() []string {
	var banned []string
	joined := strings.ToLower(strings.Join(s.RecentPhrases, " "))
	for _, p := range fillerPhrases {
		if strings.Contains(joined, p) {
			banned = append(banned, p)
		}
	}
	return banned
}

func (s *ConversationState) updateStateAfterTurn(role, text string) {
	s.Turn++
	s.updatePhase()

	words := strings.Split(strings.ToLower(text), " ")
	if len(words) > 8 {
		words = words[:8]
	}
	s.RecentPhrases = append(s.RecentPhrases, strings.Join(words, " "))
	if len(s.RecentPhrases) > 20 {
		s.RecentPhrases = s.RecentPhrases[1:]
	}

	if s.CurrentTopic != "" {
		found := false
		for _, t := range s.TopicsDiscussed {
			if t == s.CurrentTopic {
				found = true
				break
			}
		}
		if !found {
			s.TopicsDiscussed = append(s.TopicsDiscussed, s.CurrentTopic)
		}
		s.TopicTurnMap[s.CurrentTopic] = s.Turn
	}

	if role == "patient" {
		lower := strings.ToLower(text)
		for _, kw := range concernKeywords {
			if strings.Contains(lower, kw) {
				concern := fmt.Sprintf("%s (turn %d)", kw, s.Turn)
				exists := false
				for _, c := range s.FlaggedConcerns {
					if c == concern {
						exists = true
						break
					}
				}
				if !exists {
					s.FlaggedConcerns = append(s.FlaggedConcerns, concern)
					s.FollowUpDue = true
				}
			}
		}
		for _, kw := range memoryKeywords {
			if strings.Contains(lower, kw) {
				summary := text
				if idx := strings.Index(summary, "."); idx >= 0 {
					summary = summary[:idx]
				}
				if len(summary) > 60 {
					summary = summary[:60]
				}
				exists := false
				for _, m := range s.PatientMemories {
					if m == summary {
						exists = true
						break
					}
				}
				if !exists {
					s.PatientMemories = append(s.PatientMemories, summary)
					if len(s.PatientMemories) > 15 {
						s.PatientMemories = s.PatientMemories[1:]
					}
				}
				break
			}
		}
	}
}
