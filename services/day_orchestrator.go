package services

import (
	"context"
	"fmt"
	"strings"
	"time"

	"starsim/config"
	"starsim/db"
	"starsim/engine"
	"starsim/logger"
	"starsim/models"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// buildTranscriptCaregiver renders a session transcript with Caregiver/Patient labels.
func buildTranscriptCaregiver(sessionID string) string {
	ctx := context.Background()
	cur, err := db.Coll(db.CollMessages).Find(ctx, bson.M{"sessionId": sessionID},
		options.Find().SetSort(bson.D{{Key: "timestamp", Value: 1}}))
	if err != nil {
		return ""
	}
	var msgs []models.Message
	_ = cur.All(ctx, &msgs)
	var lines []string
	for _, m := range msgs {
		label := "Caregiver"
		if m.Role != "clinician" {
			label = "Patient"
		}
		lines = append(lines, label+": "+m.Text)
	}
	return strings.Join(lines, "\n")
}

// waitForSessionStop blocks until the room stops or the timeout forces a stop.
func waitForSessionStop(roomID string, maxMs int) {
	deadline := time.Now().Add(time.Duration(maxMs) * time.Millisecond)
	time.Sleep(2 * time.Second)
	for {
		if !engine.IsRoomRunning(roomID) {
			return
		}
		if time.Now().After(deadline) {
			logger.Warn("[Day Orchestrator] Session timeout for "+roomID+" — forcing stop", nil)
			_ = engine.StopRoomScheduled(roomID)
			time.Sleep(3 * time.Second)
			return
		}
		time.Sleep(2 * time.Second)
	}
}

// RunSimulationDay executes a full simulated day for a resident.
func RunSimulationDay(residentID primitive.ObjectID, dayIndexParam int) error {
	ctx := context.Background()

	var resident models.ResidentProfile
	if err := db.Coll(db.CollResidentProfiles).FindOne(ctx, bson.M{"_id": residentID}).Decode(&resident); err != nil {
		return fmt.Errorf("ResidentProfile not found: %s", residentID.Hex())
	}

	dayIndex := dayIndexParam
	if dayIndex == 0 {
		count, _ := db.Coll(db.CollSimulationDays).CountDocuments(ctx, bson.M{"residentId": residentID})
		dayIndex = int(count) + 1
	}

	admission := resident.AdmissionDate
	if admission.IsZero() {
		admission = time.Now()
	}
	simulatedDate := admission.AddDate(0, 0, dayIndex-1)

	dayType := "ongoing"
	if dayIndex == 1 {
		dayType = "day1"
	}
	noteSequence := GetNoteSequence(dayType)

	promptSnapshot := map[string]models.PromptSnapshot{}
	for _, noteType := range noteSequence {
		var rc models.RoomConfig
		if db.Coll(db.CollRoomConfigs).FindOne(ctx, bson.M{"noteType": noteType}).Decode(&rc) == nil {
			pv := ""
			if !rc.UpdatedAt.IsZero() {
				pv = rc.UpdatedAt.Format(time.RFC3339)
			}
			promptSnapshot[rc.RoomID] = models.PromptSnapshot{
				FormID: rc.NeboFormID, CaregiverPrompt: rc.CaregiverPrompt,
				PatientPrompt: rc.PatientPrompt, PromptVersion: pv,
			}
		}
	}

	now := time.Now()
	day := models.SimulationDay{
		ResidentID: residentID, PatientUUID: resident.PatientUUID, DayIndex: dayIndex,
		SimulatedDate: simulatedDate, RunDate: now, Status: "running",
		NoteSequence: noteSequence, CompletedNotes: []string{}, TriggeredNotes: []string{},
		PromptSnapshot: promptSnapshot, InstanceName: config.C.InstanceName,
		CreatedAt: now, UpdatedAt: now,
	}
	insRes, err := db.Coll(db.CollSimulationDays).InsertOne(ctx, day)
	if err != nil {
		return err
	}
	dayID := insRes.InsertedID.(primitive.ObjectID)
	logger.Info(fmt.Sprintf("[Day Orchestrator] Starting Day %d for %s — %d notes planned", dayIndex, resident.Name, len(noteSequence)), nil)

	noteQueue := append([]string{}, noteSequence...)
	sequenceIndex := 0
	var completedEncounterIDs []string

	for len(noteQueue) > 0 {
		noteType := noteQueue[0]
		noteQueue = noteQueue[1:]
		logger.Info(fmt.Sprintf("[Day Orchestrator] Executing note %d: %s", sequenceIndex+1, noteType), nil)

		enc := models.ResidentEncounter{
			ResidentID: residentID, SimulationDayID: dayID, PatientUUID: resident.PatientUUID,
			DayIndex: dayIndex, SimulatedDate: simulatedDate, SequenceIndex: sequenceIndex,
			NoteType: noteType, Status: "running", FormID: 0, RoomID: "", CreatedAt: time.Now(),
		}
		encRes, _ := db.Coll(db.CollResidentEncounters).InsertOne(ctx, enc)
		encID := encRes.InsertedID.(primitive.ObjectID)

		var rc models.RoomConfig
		if db.Coll(db.CollRoomConfigs).FindOne(ctx, bson.M{"noteType": noteType}).Decode(&rc) != nil {
			_, _ = db.Coll(db.CollResidentEncounters).UpdateByID(ctx, encID, bson.M{"$set": bson.M{
				"status": "failed", "errorMessage": "No room configured for this note type"}})
			logger.Warn("[Day Orchestrator] No room configured for note type: "+noteType, nil)
			sequenceIndex++
			continue
		}

		var nc models.NoteTypeConfig
		_ = db.Coll(db.CollNoteTypeConfigs).FindOne(ctx, bson.M{"name": noteType}).Decode(&nc)
		formID := nc.NeboFormID
		if formID == 0 {
			formID = rc.NeboFormID
		}
		if formID == 0 {
			formID = 1
		}

		hist := BuildHistoryContext(resident.PatientUUID, noteType, completedEncounterIDs)
		historySuffix := ""
		if strings.TrimSpace(hist.SummaryInjected) != "" {
			historySuffix = "\n\n--- RESIDENT HISTORY ---\n" + hist.SummaryInjected
		}

		caregiverRaw := composePrompt(rc.CaregiverPrompt, nc.NotePrompt, nc.UseNotePromptOnly, historySuffix)
		patientRaw := composePrompt(rc.PatientPrompt, nc.PatientNotePrompt, nc.UsePatientNotePromptOnly, historySuffix)
		tokenVars := map[string]string{"caregiverName": rc.CaregiverName, "residentName": resident.Name, "noteType": noteType}
		caregiverPrompt := ResolvePromptTokens(caregiverRaw, tokenVars)
		patientPrompt := ResolvePromptTokens(patientRaw, tokenVars)

		_, _ = db.Coll(db.CollResidentEncounters).UpdateByID(ctx, encID, bson.M{"$set": bson.M{
			"formId": formID, "roomId": rc.RoomID, "caregiverPrompt": caregiverPrompt,
			"patientPrompt": patientPrompt, "historyContext": hist}})

		// Temporarily inject prompts into the room config
		origCaregiver, origPatient := rc.CaregiverPrompt, rc.PatientPrompt
		_, _ = db.Coll(db.CollRoomConfigs).UpdateByID(ctx, rc.ID, bson.M{"$set": bson.M{
			"caregiverPrompt": caregiverPrompt, "patientPrompt": patientPrompt}})

		var conversationTranscript string
		sessionID, startErr := engine.StartRoomScheduled(rc.RoomID, false)
		if startErr != nil {
			_, _ = db.Coll(db.CollResidentEncounters).UpdateByID(ctx, encID, bson.M{"$set": bson.M{
				"status": "failed", "errorMessage": startErr.Error()}})
		} else {
			waitForSessionStop(rc.RoomID, 10*60*1000)
			conversationTranscript = buildTranscriptCaregiver(sessionID)
			_, _ = db.Coll(db.CollResidentEncounters).UpdateByID(ctx, encID, bson.M{"$set": bson.M{
				"conversationTranscript": conversationTranscript}})
		}
		// restore original prompts
		_, _ = db.Coll(db.CollRoomConfigs).UpdateByID(ctx, rc.ID, bson.M{"$set": bson.M{
			"caregiverPrompt": origCaregiver, "patientPrompt": origPatient}})

		// Poll Nebo for the generated note
		if resident.NeboUserID > 0 {
			time.Sleep(5 * time.Second)
			notes := GetUserNotes(resident.NeboUserID, rc.NeboFormID)
			if len(notes) > 0 {
				latest := notes[0]
				result := PollNeboResult(resident.NeboUserID, latest.JobID, 5*time.Second, 120*time.Second)
				if result != nil {
					_, _ = db.Coll(db.CollResidentEncounters).UpdateByID(ctx, encID, bson.M{"$set": bson.M{
						"neboJobId": latest.JobID, "neboNoteLogId": latest.NoteLogID, "neboStatus": "completed",
						"noteFields": result.Fields, "transcript": result.Transcript,
						"wordCount": result.WordCount, "tokenCount": result.TokenCount, "waitTime": result.WaitTime}})
				} else {
					_, _ = db.Coll(db.CollResidentEncounters).UpdateByID(ctx, encID, bson.M{"$set": bson.M{
						"neboStatus": "failed", "errorMessage": "Nebo timeout after 120s"}})
				}
			}
		}

		// Trigger scan
		var fresh models.ResidentEncounter
		_ = db.Coll(db.CollResidentEncounters).FindOne(ctx, bson.M{"_id": encID}).Decode(&fresh)
		triggersDetected, triggeredNoteTypes := ScanForTriggers(fresh.NoteFields, conversationTranscript, noteQueue)
		if len(triggeredNoteTypes) > 0 {
			noteQueue = append(noteQueue, triggeredNoteTypes...)
			_, _ = db.Coll(db.CollSimulationDays).UpdateByID(ctx, dayID, bson.M{"$push": bson.M{
				"triggeredNotes": bson.M{"$each": triggeredNoteTypes}}})
			logger.Info("[Day Orchestrator] Triggered notes: "+strings.Join(triggeredNoteTypes, ", "), nil)
		}

		completedAt := time.Now()
		_, _ = db.Coll(db.CollResidentEncounters).UpdateByID(ctx, encID, bson.M{"$set": bson.M{
			"triggersDetected": triggersDetected, "triggeredNoteTypes": triggeredNoteTypes,
			"status": "completed", "completedAt": completedAt}})
		_, _ = db.Coll(db.CollSimulationDays).UpdateByID(ctx, dayID, bson.M{"$push": bson.M{"completedNotes": noteType}})
		completedEncounterIDs = append(completedEncounterIDs, encID.Hex())
		sequenceIndex++
	}

	// Completion
	cur, _ := db.Coll(db.CollResidentEncounters).Find(ctx, bson.M{"simulationDayId": dayID, "status": "completed"})
	var completed []models.ResidentEncounter
	_ = cur.All(ctx, &completed)
	var keyParts []string
	for _, e := range completed {
		if len(e.NoteFields) > 0 && e.NoteFields[0].Content != "" {
			keyParts = append(keyParts, e.NoteFields[0].Content)
		}
	}
	if len(keyParts) > 3 {
		keyParts = keyParts[:3]
	}
	keyFindings := strings.Join(keyParts, " | ")

	var completedNames []string
	for _, e := range completed {
		completedNames = append(completedNames, e.NoteType)
	}
	summary := fmt.Sprintf("Day %d completed with %d notes. Notes generated: %s. ", dayIndex, len(completed), strings.Join(completedNames, ", "))
	var refreshedDay models.SimulationDay
	_ = db.Coll(db.CollSimulationDays).FindOne(ctx, bson.M{"_id": dayID}).Decode(&refreshedDay)
	if len(refreshedDay.TriggeredNotes) > 0 {
		summary += "Triggered notes: " + strings.Join(refreshedDay.TriggeredNotes, ", ") + ". "
	}
	if keyFindings != "" {
		summary += "Key findings: " + keyFindings + "."
	}
	_, _ = db.Coll(db.CollSimulationDays).UpdateByID(ctx, dayID, bson.M{"$set": bson.M{"status": "completed", "summary": summary}})

	// Day-1 special handling
	if dayIndex == 1 {
		for _, e := range completed {
			if e.NoteType == "Admission Note" {
				for _, f := range e.NoteFields {
					if f.Key == "diagnosis" || strings.Contains(strings.ToLower(f.Label), "diagnosis") {
						if f.Content != "" {
							_, _ = db.Coll(db.CollResidentProfiles).UpdateByID(ctx, residentID, bson.M{"$set": bson.M{
								"primaryDiagnosis": f.Content, "baselineSummary": summary}})
						}
						break
					}
				}
			}
		}
	}
	return nil
}

func composePrompt(basePrompt, notePrompt string, useNoteOnly bool, historySuffix string) string {
	if useNoteOnly && strings.TrimSpace(notePrompt) != "" {
		return notePrompt + historySuffix
	}
	out := basePrompt
	if strings.TrimSpace(notePrompt) != "" {
		out += "\n\n--- NOTE INSTRUCTIONS ---\n" + notePrompt
	}
	return out + historySuffix
}
