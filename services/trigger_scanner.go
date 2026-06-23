package services

import (
	"context"
	"regexp"
	"strings"

	"starsim/db"
	"starsim/models"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
)

var painScorePattern = regexp.MustCompile(`\b([7-9]|10)/10\b`)

type triggerRule struct {
	keyword          string
	field            string // "content" | "transcript"
	triggersNoteType string
}

var triggerRules = []triggerRule{
	{"pain", "content", "SBAR Note"},
	{"fall", "transcript", "Incident/Event Note"},
	{"fell", "transcript", "Incident/Event Note"},
	{"wound", "content", "Wound Care"},
	{"skin breakdown", "content", "Wound Care"},
	{"agitat", "transcript", "Behavior Note"},
	{"behavior", "transcript", "Behavior Note"},
	{"medication change", "content", "Medication Follow-up"},
}

var triggerNameMap = map[string]string{
	"SBAR Note":            "pain_high",
	"Incident/Event Note":  "fall_mentioned",
	"Wound Care":           "wound_noted",
	"Behavior Note":        "behavior_flagged",
	"Medication Follow up": "medication_change",
}

func toTriggerName(noteType string) string {
	if n, ok := triggerNameMap[noteType]; ok {
		return n
	}
	return strings.ReplaceAll(strings.ToLower(noteType), " ", "_")
}

// ScanForTriggers detects clinical triggers in note fields / transcript.
func ScanForTriggers(noteFields []models.NoteField, transcript string, currentQueue []string) (triggersDetected, triggeredNoteTypes []string) {
	var contentParts []string
	for _, f := range noteFields {
		contentParts = append(contentParts, f.Content)
	}
	contentText := strings.Join(contentParts, " ")

	inQueue := func(s string) bool {
		for _, q := range currentQueue {
			if q == s {
				return true
			}
		}
		return false
	}
	inTriggered := func(s string) bool {
		for _, q := range triggeredNoteTypes {
			if q == s {
				return true
			}
		}
		return false
	}

	for _, r := range triggerRules {
		searchText := transcript
		if r.field == "content" {
			searchText = contentText
		}
		matched := false
		if r.keyword == "pain" {
			matched = painScorePattern.MatchString(searchText) && strings.Contains(strings.ToLower(searchText), "pain")
		} else {
			matched = strings.Contains(strings.ToLower(searchText), strings.ToLower(r.keyword))
		}
		if matched && !inQueue(r.triggersNoteType) && !inTriggered(r.triggersNoteType) {
			triggeredNoteTypes = append(triggeredNoteTypes, r.triggersNoteType)
			triggersDetected = append(triggersDetected, toTriggerName(r.triggersNoteType))
		}
	}
	return triggersDetected, triggeredNoteTypes
}

// GetNoteSequence returns enabled note type names for a day type ("day1"|"ongoing").
func GetNoteSequence(dayType string) []string {
	ctx := context.Background()
	cur, err := db.Coll(db.CollNoteTypeConfigs).Find(ctx,
		bson.M{"enabled": true, "dayType": bson.M{"$in": []string{dayType, "both"}}},
		options.Find().SetSort(bson.D{{Key: "order", Value: 1}}))
	if err != nil {
		return nil
	}
	var docs []models.NoteTypeConfig
	_ = cur.All(ctx, &docs)
	var names []string
	for _, d := range docs {
		names = append(names, d.Name)
	}
	return names
}
