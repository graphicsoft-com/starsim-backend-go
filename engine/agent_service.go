package engine

import (
	"context"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"

	"starsim/config"
	"starsim/db"
	"starsim/logger"
	"starsim/models"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const (
	vitsSynthOverheadMS = 20000
	postAckPauseMS      = 800
	maxHistoryLength    = 20
	endToken            = "[END_SIMULATION]"
)

type speakerInfo struct {
	caregiverName   string
	caregiverGender string
	patientName     string
	patientGender   string
}

type roomRuntime struct {
	active     bool
	stopReason string
	cancel     context.CancelFunc

	// tts ack coordination
	ackCh        chan struct{}
	expectedTurn int
	expectedRole string
	hasPending   bool

	// voice ready handshake
	voiceReadyRoles map[string]bool
	voiceReadyCh    chan struct{}
	voiceReadyDone  bool

	speaker speakerInfo
}

var (
	mu    sync.Mutex
	rooms = map[string]*roomRuntime{}
)

func getRT(roomID string) *roomRuntime {
	rt := rooms[roomID]
	if rt == nil {
		rt = &roomRuntime{voiceReadyRoles: map[string]bool{}}
		rooms[roomID] = rt
	}
	return rt
}

// estimateTtsDurationMs computes a dynamic timeout from word count (150 wpm).
func estimateTtsDurationMs(text string) time.Duration {
	words := len(strings.Fields(strings.TrimSpace(text)))
	speechMs := math.Round(float64(words) / 150.0 * 60.0 * 1000.0)
	ms := math.Min(120000, math.Max(15000, speechMs+4000))
	return time.Duration(ms) * time.Millisecond
}

func getSpeakerInfo(roomID, role string) (string, string) {
	mu.Lock()
	defer mu.Unlock()
	rt := rooms[roomID]
	if rt == nil {
		return "Unknown", "male"
	}
	if role == "clinician" {
		if rt.speaker.caregiverName == "" {
			return "Unknown", "male"
		}
		return rt.speaker.caregiverName, rt.speaker.caregiverGender
	}
	if rt.speaker.patientName == "" {
		return "Unknown", "male"
	}
	return rt.speaker.patientName, rt.speaker.patientGender
}

// AcknowledgeVoiceReady records that a role's voice is ready; once both
// clinician and patient have reported, the conversation may begin.
func AcknowledgeVoiceReady(roomID, role string) {
	mu.Lock()
	defer mu.Unlock()
	rt := getRT(roomID)
	rt.voiceReadyRoles[role] = true
	size := len(rt.voiceReadyRoles)
	logger.RoomLog(roomID, "info", fmt.Sprintf("Voice ready from %s (%d/2)", role, size), nil)
	if size >= 2 && !rt.voiceReadyDone && rt.voiceReadyCh != nil {
		logger.RoomLog(roomID, "info", "All voices ready — starting conversation", nil)
		rt.voiceReadyDone = true
		close(rt.voiceReadyCh)
	}
}

// AcknowledgeTTS is called when an Oid machine reports it finished speaking.
func AcknowledgeTTS(roomID string, turnNumber int, role string) {
	mu.Lock()
	defer mu.Unlock()
	rt := rooms[roomID]
	if rt == nil || !rt.hasPending {
		logger.RoomLog(roomID, "warn", fmt.Sprintf("Ignoring tts_done with no pending ack [turn=%d role=%s]", turnNumber, role), nil)
		return
	}
	if rt.expectedTurn != turnNumber || rt.expectedRole != role {
		logger.RoomLog(roomID, "warn", fmt.Sprintf("Ignoring stale/mismatched tts_done [got turn=%d role=%s] [expected turn=%d role=%s]", turnNumber, role, rt.expectedTurn, rt.expectedRole), nil)
		return
	}
	logger.RoomLog(roomID, "info", fmt.Sprintf("TTS ack received — advancing [turn=%d role=%s]", turnNumber, role), nil)
	rt.hasPending = false
	select {
	case rt.ackCh <- struct{}{}:
	default:
	}
}

// GetTTSExpectedTurn returns the turn the server is currently waiting on.
func GetTTSExpectedTurn(roomID string) (int, bool) {
	mu.Lock()
	defer mu.Unlock()
	rt := rooms[roomID]
	if rt == nil || !rt.hasPending {
		return 0, false
	}
	return rt.expectedTurn, true
}

func cancelPendingTTSAck(roomID string, resolvePending bool) {
	mu.Lock()
	defer mu.Unlock()
	rt := rooms[roomID]
	if rt == nil {
		return
	}
	if resolvePending && rt.hasPending {
		select {
		case rt.ackCh <- struct{}{}:
		default:
		}
	}
	rt.hasPending = false
}

// waitForTTSAck blocks until the Oid reports done, a safety timeout fires, or
// the room is stopped. Silent / disabled providers return immediately.
func waitForTTSAck(ctx context.Context, roomID, text string, turnNumber int, role string) {
	mu.Lock()
	rt := rooms[roomID]
	if rt == nil || !rt.active {
		mu.Unlock()
		return
	}
	provider := getProvider(roomID)
	if provider == "disabled" {
		mu.Unlock()
		return
	}
	overhead := 0
	if provider == "vits" {
		overhead = vitsSynthOverheadMS
	}
	timeout := estimateTtsDurationMs(text) + time.Duration(overhead)*time.Millisecond
	ch := make(chan struct{}, 1)
	rt.ackCh = ch
	rt.expectedTurn = turnNumber
	rt.expectedRole = role
	rt.hasPending = true
	mu.Unlock()

	select {
	case <-ch:
	case <-time.After(timeout):
		mu.Lock()
		if rt.hasPending {
			logger.RoomLog(roomID, "warn", fmt.Sprintf("TTS safety timeout (%dms) — advancing anyway [turn=%d role=%s textLen=%d]", timeout.Milliseconds(), turnNumber, role, len(text)), nil)
			rt.hasPending = false
		}
		mu.Unlock()
	case <-ctx.Done():
	}
}

// StopRoom signals a running room to stop with an optional reason.
func StopRoom(roomID, reason string) {
	mu.Lock()
	rt := rooms[roomID]
	if rt == nil || !rt.active {
		mu.Unlock()
		logger.RoomLog(roomID, "warn", "Was not running", nil)
		return
	}
	rt.active = false
	if reason != "" {
		rt.stopReason = reason
	}
	if rt.cancel != nil {
		rt.cancel()
	}
	// unblock voice-ready gate
	if !rt.voiceReadyDone && rt.voiceReadyCh != nil {
		rt.voiceReadyDone = true
		close(rt.voiceReadyCh)
	}
	r := reason
	if r == "" {
		r = "manual"
	}
	mu.Unlock()
	cancelPendingTTSAck(roomID, true)
	logger.RoomLog(roomID, "info", fmt.Sprintf("Stop signal sent (reason=%s)", r), nil)
}

// GetRoomStatus reports whether a room's conversation loop is active.
func GetRoomStatus(roomID string) bool {
	mu.Lock()
	defer mu.Unlock()
	rt := rooms[roomID]
	return rt != nil && rt.active
}

// GetAllRoomStatuses returns a snapshot of every room's active flag.
func GetAllRoomStatuses() map[string]bool {
	mu.Lock()
	defer mu.Unlock()
	out := map[string]bool{}
	for id, rt := range rooms {
		if rt.active {
			out[id] = true
		}
	}
	return out
}

func truncateMessage(text string, wordLimit int) string {
	words := strings.Fields(text)
	if len(words) <= wordLimit {
		return strings.Join(words, " ")
	}
	return strings.Join(words[:wordLimit], " ") + "..."
}

// RunRoom executes the conversation loop for a session. Blocks until the
// session stops; intended to be run in its own goroutine.
func RunRoom(roomID, sessionID string) {
	ctx, cancel := context.WithCancel(context.Background())
	logger.RoomLog(roomID, "info", fmt.Sprintf("Starting simulation (session: %s)", sessionID), Fields(nil))

	state := createConversationState(sessionID, roomID)

	// Load DB config
	var clinicianBase, patientBase, patientName, clinicianName, patientProfile string
	cfgDoc, err := loadRoomConfig(roomID)
	if err != nil || cfgDoc == nil {
		logger.RoomLog(roomID, "warn", fmt.Sprintf("Failed to load room config — using fallbacks: %v", err), nil)
		patientName = "Unknown Patient"
		clinicianName = "Unknown Clinician"
	} else {
		clinicianBase = cfgDoc.CaregiverPrompt
		patientBase = cfgDoc.PatientPrompt
		patientName = cfgDoc.PatientName
		clinicianName = cfgDoc.CaregiverName
		patientProfile = cfgDoc.PatientProfile
	}

	mu.Lock()
	rt := getRT(roomID)
	rt.active = true
	rt.cancel = cancel
	rt.stopReason = ""
	rt.voiceReadyRoles = map[string]bool{}
	rt.voiceReadyDone = false
	rt.voiceReadyCh = make(chan struct{})
	if cfgDoc != nil {
		rt.speaker = speakerInfo{
			caregiverName:   cfgDoc.CaregiverName,
			caregiverGender: cfgDoc.CaregiverGender,
			patientName:     cfgDoc.PatientName,
			patientGender:   cfgDoc.PatientGender,
		}
	}
	voiceReadyCh := rt.voiceReadyCh
	mu.Unlock()

	// Persist names to session
	profileSummary := patientProfile
	if len(profileSummary) > 120 {
		profileSummary = profileSummary[:120]
	}
	_, _ = db.Coll(db.CollSessions).UpdateOne(ctx, bson.M{"sessionId": sessionID}, bson.M{"$set": bson.M{
		"patientProfile": fmt.Sprintf("%s — %s", patientName, profileSummary),
		"clinicianName":  clinicianName,
		"patientName":    patientName,
	}})

	alertSessionStarted(roomID, sessionID)

	history := []agentMessage{}

	// Voice-ready gate
	ttsDisabled := getProvider(roomID) == "disabled"
	mu.Lock()
	alreadyReady := ttsDisabled || len(rt.voiceReadyRoles) >= 2
	mu.Unlock()
	if !alreadyReady {
		select {
		case <-voiceReadyCh:
		case <-time.After(120 * time.Second):
			mu.Lock()
			got := len(rt.voiceReadyRoles)
			mu.Unlock()
			logger.RoomLog(roomID, "warn", fmt.Sprintf("Voice ready timeout (120s) — starting with %d/2 ready", got), nil)
		case <-ctx.Done():
		}
	}
	if !GetRoomStatus(roomID) {
		logger.RoomLog(roomID, "info", "Room stopped while waiting for voice ready", nil)
		finalizeSession(roomID, sessionID, state)
		return
	}

	type prefetch struct {
		text string
		role string
	}
	var prefetched *prefetch

	for turn := 0; ; turn++ {
		if !GetRoomStatus(roomID) {
			logger.RoomLog(roomID, "info", fmt.Sprintf("Stopped at turn %d", turn), nil)
			break
		}

		expectedRole := "clinician"
		if turn%2 != 0 {
			expectedRole = "patient"
		}

		var text string
		if prefetched != nil && prefetched.role == expectedRole {
			text = prefetched.text
			if expectedRole == "clinician" {
				history = append(history, agentMessage{Role: "assistant", Content: text})
			} else {
				history = append(history, agentMessage{Role: "user", Content: text})
			}
			prefetched = nil
			logger.RoomLog(roomID, "info", fmt.Sprintf("Turn %d — prefetch HIT (%s)", turn+1, expectedRole), nil)
		} else {
			var genErr error
			if expectedRole == "clinician" {
				prompt := clinicianBase
				if prompt == "" {
					prompt = buildClinicianPrompt(clinicianName, patientName, state)
				}
				text, genErr = getAgentResponse(ctx, prompt, history, 3)
				if genErr == nil {
					history = append(history, agentMessage{Role: "assistant", Content: text})
				}
			} else {
				var prompt string
				if patientBase != "" {
					prompt = patientPromptWithDirectives(patientBase, state)
				} else {
					prompt = buildPatientPrompt(patientName, patientProfile, state)
				}
				text, genErr = getAgentResponse(ctx, prompt, flipHistory(history), 3)
				if genErr == nil {
					history = append(history, agentMessage{Role: "user", Content: text})
				}
			}
			if genErr != nil {
				logger.RoomLog(roomID, "error", fmt.Sprintf("Turn %d failed: %v", turn, genErr), nil)
				continue
			}
		}

		if strings.TrimSpace(text) == "" {
			continue
		}
		if !GetRoomStatus(roomID) {
			logger.RoomLog(roomID, "info", fmt.Sprintf("Stop detected before emitting turn %d", turn+1), nil)
			break
		}

		shouldEnd := strings.Contains(text, endToken)
		if shouldEnd {
			text = strings.TrimSpace(strings.ReplaceAll(text, endToken, ""))
			logger.RoomLog(roomID, "info", fmt.Sprintf("[END_SIMULATION] detected — will stop after turn %d", turn+1), nil)
		}

		role := expectedRole
		state.updateStateAfterTurn(role, text)
		ts := time.Now()

		// Persist message + increment session count
		_, _ = db.Coll(db.CollMessages).InsertOne(ctx, models.Message{
			SessionID: sessionID, RoomID: roomID, Role: role, Text: text, Timestamp: ts,
		})
		_, _ = db.Coll(db.CollSessions).UpdateOne(ctx, bson.M{"sessionId": sessionID}, bson.M{"$inc": bson.M{"messageCount": 1}})

		label := "Clinician"
		if role == "patient" {
			label = "Patient"
		}
		logger.RoomLog(roomID, "info", fmt.Sprintf("Turn %d — %s: \"%s\"", turn+1, label, truncateMessage(text, 4)), Fields{"turn": turn + 1})

		speakerName, speakerGender := getSpeakerInfo(roomID, role)
		if emitter != nil {
			emitter.EmitMessage(MsgPayload{
				RoomID: roomID, SessionID: sessionID, Role: role, Text: text,
				Timestamp: ts, TurnNumber: turn + 1, SpeakerName: speakerName, SpeakerGender: speakerGender,
			})
		}

		// Speculative prefetch of the next turn
		if emitter != nil && GetRoomStatus(roomID) && !shouldEnd {
			nextRole := "clinician"
			if (turn+1)%2 != 0 {
				nextRole = "patient"
			}
			histSnapshot := append([]agentMessage(nil), history...)
			go func(nextRole string, nextTurnIdx int, snapshot []agentMessage) {
				var nextText string
				var e error
				if nextRole == "clinician" {
					prompt := clinicianBase
					if prompt == "" {
						prompt = buildClinicianPrompt(clinicianName, patientName, state)
					}
					nextText, e = getAgentResponse(context.Background(), prompt, snapshot, 3)
				} else {
					var prompt string
					if patientBase != "" {
						prompt = patientPromptWithDirectives(patientBase, state)
					} else {
						prompt = buildPatientPrompt(patientName, patientProfile, state)
					}
					nextText, e = getAgentResponse(context.Background(), prompt, flipHistory(snapshot), 3)
				}
				if e != nil || !GetRoomStatus(roomID) {
					return
				}
				prefetched = &prefetch{text: nextText, role: nextRole}
				sn, sg := getSpeakerInfo(roomID, nextRole)
				emitter.EmitPrefetch(PrefetchPayload{
					RoomID: roomID, Text: nextText, TurnNumber: nextTurnIdx + 1,
					SpeakerName: sn, SpeakerGender: sg, Role: nextRole,
				})
				logger.RoomLog(roomID, "info", fmt.Sprintf("Prefetch turn %d ready (%s)", nextTurnIdx+1, nextRole), nil)
			}(nextRole, turn+1, histSnapshot)
		}

		if !GetRoomStatus(roomID) {
			break
		}
		waitForTTSAck(ctx, roomID, text, turn+1, role)
		if !GetRoomStatus(roomID) {
			break
		}
		select {
		case <-time.After(postAckPauseMS * time.Millisecond):
		case <-ctx.Done():
		}
		if shouldEnd {
			StopRoom(roomID, "simulation_ended")
			break
		}
	}

	finalizeSession(roomID, sessionID, state)
}

func finalizeSession(roomID, sessionID string, state *ConversationState) {
	ctx := context.Background()
	now := time.Now()
	_, _ = db.Coll(db.CollSessions).UpdateOne(ctx, bson.M{"sessionId": sessionID},
		bson.M{"$set": bson.M{"status": "stopped", "endTime": now}})

	mu.Lock()
	rt := rooms[roomID]
	stopReason := "manual"
	if rt != nil && rt.stopReason != "" {
		stopReason = rt.stopReason
	}
	mu.Unlock()

	var startTime time.Time = now
	var sess models.Session
	if err := db.Coll(db.CollSessions).FindOne(ctx, bson.M{"sessionId": sessionID}).Decode(&sess); err == nil {
		startTime = sess.StartTime
	}
	alertSessionStopped(roomID, sessionID, startTime, state.Turn, stopReason)

	// Cleanup before Nebo so the scheduler cannot relaunch mid-registration.
	mu.Lock()
	delete(rooms, roomID)
	mu.Unlock()
	cancelPendingTTSAck(roomID, false)

	registerEncounterWithNebo(roomID, sessionID)
	logger.RoomLog(roomID, "info", "Session complete", nil)
}

func loadRoomConfig(roomID string) (*models.RoomConfig, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var rc models.RoomConfig
	err := db.Coll(db.CollRoomConfigs).FindOne(ctx, bson.M{"roomId": roomID}).Decode(&rc)
	if err != nil {
		return nil, err
	}
	return &rc, nil
}

// BuildSessionID formats a session id like 2026-05-07_02-30PM_room1.
func BuildSessionID(roomID string, t time.Time) string {
	h24 := t.Hour()
	ampm := "AM"
	if h24 >= 12 {
		ampm = "PM"
	}
	h12 := h24 % 12
	if h12 == 0 {
		h12 = 12
	}
	return fmt.Sprintf("%04d-%02d-%02d_%02d-%02d%s_%s",
		t.Year(), int(t.Month()), t.Day(), h12, t.Minute(), ampm, roomID)
}

// StartRoomScheduled creates a Session and launches the conversation loop in
// the background. Used by the scheduler, day orchestrator, and start-all.
func StartRoomScheduled(roomID string, scheduledStart bool) (string, error) {
	if GetRoomStatus(roomID) {
		return "", fmt.Errorf("%s is already running", roomID)
	}
	now := time.Now()
	sessionID := BuildSessionID(roomID, now)
	sess := models.Session{
		SessionID:      sessionID,
		RoomID:         roomID,
		PatientProfile: "PENDING",
		Status:         "active",
		StartTime:      now,
		MessageCount:   0,
		ScheduledStart: scheduledStart,
		InstanceName:   config.C.InstanceName,
	}
	if _, err := db.Coll(db.CollSessions).InsertOne(context.Background(), sess); err != nil {
		return "", err
	}
	go RunRoom(roomID, sessionID)
	return sessionID, nil
}

// StopRoomScheduled stops a scheduler-started room and flips its DB status.
func StopRoomScheduled(roomID string) error {
	if !GetRoomStatus(roomID) {
		return fmt.Errorf("%s is not running", roomID)
	}
	StopRoom(roomID, "scheduled")
	now := time.Now()
	_, _ = db.Coll(db.CollSessions).UpdateOne(context.Background(),
		bson.M{"roomId": roomID, "status": "active"},
		bson.M{"$set": bson.M{"status": "stopped", "endTime": now}},
		options.Update())
	if emitter != nil {
		emitter.EmitRoomUpdate(roomID, "idle")
	}
	return nil
}

// IsRoomRunning is an alias used by the orchestrator.
func IsRoomRunning(roomID string) bool { return GetRoomStatus(roomID) }
