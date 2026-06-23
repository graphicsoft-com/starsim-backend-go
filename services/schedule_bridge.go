package services

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"starsim/config"
	"starsim/db"
	"starsim/logger"
	"starsim/models"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// SessionRef pairs a room with its session id.
type SessionRef struct {
	RoomID    string
	SessionID string
}

type cachedConfig struct {
	caregiverPrompt string
	patientPrompt   string
	noteType        string
}

var (
	bridgeMu              sync.Mutex
	activeEncounterByRoom = map[string]string{}
	originalConfigCache   = map[string]cachedConfig{}
)

func init() {
	OnSessionEndedNaturally = finalizeOnNaturalEnd
}

func startOfToday() time.Time {
	n := time.Now()
	return time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, n.Location())
}

func getOrCreateTodaySimulationDay(resident models.ResidentProfile) (primitive.ObjectID, int, []string) {
	ctx := context.Background()
	dayStart := startOfToday()
	dayEnd := dayStart.AddDate(0, 0, 1)
	var day models.SimulationDay
	err := db.Coll(db.CollSimulationDays).FindOne(ctx, bson.M{
		"residentId": resident.ID,
		"runDate":    bson.M{"$gte": dayStart, "$lt": dayEnd},
	}).Decode(&day)
	if err == nil {
		dt := "ongoing"
		if day.DayIndex == 1 {
			dt = "day1"
		}
		return day.ID, day.DayIndex, GetNoteSequence(dt)
	}
	count, _ := db.Coll(db.CollSimulationDays).CountDocuments(ctx, bson.M{"residentId": resident.ID})
	dayIndex := int(count) + 1
	dt := "ongoing"
	if dayIndex == 1 {
		dt = "day1"
	}
	seq := GetNoteSequence(dt)
	admission := resident.AdmissionDate
	if admission.IsZero() {
		admission = time.Now()
	}
	now := time.Now()
	newDay := models.SimulationDay{
		ResidentID: resident.ID, PatientUUID: resident.PatientUUID, DayIndex: dayIndex,
		SimulatedDate: admission.AddDate(0, 0, dayIndex-1), RunDate: now, Status: "running",
		NoteSequence: seq, CompletedNotes: []string{}, TriggeredNotes: []string{},
		PromptSnapshot: map[string]models.PromptSnapshot{}, InstanceName: config.C.InstanceName,
		CreatedAt: now, UpdatedAt: now,
	}
	res, err := db.Coll(db.CollSimulationDays).InsertOne(ctx, newDay)
	if err != nil {
		return primitive.NilObjectID, dayIndex, seq
	}
	return res.InsertedID.(primitive.ObjectID), dayIndex, seq
}

// OnScheduledSlotStart prepares per-room encounters and injects note prompts.
func OnScheduledSlotStart(slotIndex int) {
	logger.ScheduleLog("info", fmt.Sprintf("[ScheduleBridge] Slot %d — setting up encounters", slotIndex), nil)
	ctx := context.Background()
	cur, err := db.Coll(db.CollRoomConfigs).Find(ctx, bson.M{"patientName": bson.M{"$exists": true, "$ne": ""}})
	if err != nil {
		return
	}
	var rooms []models.RoomConfig
	_ = cur.All(ctx, &rooms)
	for _, room := range rooms {
		var resident models.ResidentProfile
		if db.Coll(db.CollResidentProfiles).FindOne(ctx, bson.M{"name": room.PatientName}).Decode(&resident) != nil {
			logger.ScheduleLog("warn", "[ScheduleBridge] No resident for "+room.PatientName, nil)
			continue
		}
		dayID, dayIndex, seq := getOrCreateTodaySimulationDay(resident)
		if len(seq) == 0 {
			logger.ScheduleLog("warn", "[ScheduleBridge] Empty note sequence — run POST /api/note-sequence/seed first", nil)
			continue
		}
		noteType := seq[slotIndex%len(seq)]
		var nc models.NoteTypeConfig
		_ = db.Coll(db.CollNoteTypeConfigs).FindOne(ctx, bson.M{"name": noteType}).Decode(&nc)
		formID := nc.NeboFormID
		if formID == 0 {
			formID = room.NeboFormID
		}
		if formID == 0 {
			formID = 1
		}

		var hist models.HistoryContext
		if nc.RequiresHistory {
			hist = BuildHistoryContext(resident.PatientUUID, noteType, nil)
		} else {
			hist = models.HistoryContext{SourceEncounterIDs: []string{}}
		}
		historySuffix := ""
		if strings.TrimSpace(hist.SummaryInjected) != "" {
			historySuffix = "\n\n--- RESIDENT HISTORY ---\n" + hist.SummaryInjected
		}
		tokenVars := map[string]string{"caregiverName": room.CaregiverName, "residentName": resident.Name, "noteType": noteType}
		caregiverPrompt := ResolvePromptTokens(composePrompt(room.CaregiverPrompt, nc.NotePrompt, nc.UseNotePromptOnly, historySuffix), tokenVars)
		patientPrompt := ResolvePromptTokens(composePrompt(room.PatientPrompt, nc.PatientNotePrompt, nc.UsePatientNotePromptOnly, historySuffix), tokenVars)

		completedToday, _ := db.Coll(db.CollResidentEncounters).CountDocuments(ctx, bson.M{
			"residentId": resident.ID, "simulationDayId": dayID, "status": "completed"})

		now := time.Now()
		enc := models.ResidentEncounter{
			ResidentID: resident.ID, SimulationDayID: dayID, PatientUUID: resident.PatientUUID,
			DayIndex: dayIndex, SimulatedDate: now, SequenceIndex: int(completedToday), NoteType: noteType,
			FormID: formID, RoomID: room.RoomID, Status: "running", CaregiverPrompt: caregiverPrompt,
			PatientPrompt: patientPrompt, HistoryContext: hist, ScheduledAt: &now, SlotIndex: slotIndex, CreatedAt: now,
		}
		res, _ := db.Coll(db.CollResidentEncounters).InsertOne(ctx, enc)
		encID := res.InsertedID.(primitive.ObjectID)

		bridgeMu.Lock()
		originalConfigCache[room.RoomID] = cachedConfig{room.CaregiverPrompt, room.PatientPrompt, room.NoteType}
		activeEncounterByRoom[room.RoomID] = encID.Hex()
		bridgeMu.Unlock()

		_, _ = db.Coll(db.CollRoomConfigs).UpdateByID(ctx, room.ID, bson.M{"$set": bson.M{
			"caregiverPrompt": caregiverPrompt, "patientPrompt": patientPrompt, "noteType": noteType}})

		logger.ScheduleLog("info", fmt.Sprintf("[ScheduleBridge] Prepared %s for %s in %s (Day %d, slot %d)", noteType, resident.Name, room.RoomID, dayIndex, slotIndex), nil)
	}
}

// OnScheduledSlotStop finalizes encounters for stopped sessions.
func OnScheduledSlotStop(sessions []SessionRef) {
	ctx := context.Background()
	sessionByRoom := map[string]string{}
	for _, s := range sessions {
		sessionByRoom[s.RoomID] = s.SessionID
	}
	cur, _ := db.Coll(db.CollResidentEncounters).Find(ctx, bson.M{
		"status": "running", "createdAt": bson.M{"$gte": startOfToday()}},
		options.Find().SetProjection(bson.M{"_id": 1, "roomId": 1}))
	var running []struct {
		ID     primitive.ObjectID `bson:"_id"`
		RoomID string             `bson:"roomId"`
	}
	_ = cur.All(ctx, &running)
	for _, r := range running {
		sessionID := sessionByRoom[r.RoomID]
		if sessionID == "" {
			bridgeMu.Lock()
			sessionID = activeEncounterByRoom[r.RoomID]
			bridgeMu.Unlock()
		}
		if sessionID == "" {
			var sess models.Session
			_ = db.Coll(db.CollSessions).FindOne(ctx, bson.M{"roomId": r.RoomID, "startTime": bson.M{"$gte": startOfToday()}},
				options.FindOne().SetSort(bson.D{{Key: "startTime", Value: -1}})).Decode(&sess)
			sessionID = sess.SessionID
		}
		bridgeMu.Lock()
		delete(activeEncounterByRoom, r.RoomID)
		bridgeMu.Unlock()
		finalizeEncounter(r.ID.Hex(), r.RoomID, sessionID)
	}
}

func finalizeOnNaturalEnd(roomID, sessionID string) {
	ctx := context.Background()
	bridgeMu.Lock()
	encID := activeEncounterByRoom[roomID]
	bridgeMu.Unlock()
	if encID == "" {
		var enc models.ResidentEncounter
		if db.Coll(db.CollResidentEncounters).FindOne(ctx, bson.M{
			"roomId": roomID, "status": "running", "createdAt": bson.M{"$gte": startOfToday()}}).Decode(&enc) != nil {
			return
		}
		encID = enc.ID.Hex()
	}
	bridgeMu.Lock()
	delete(activeEncounterByRoom, roomID)
	bridgeMu.Unlock()
	finalizeEncounter(encID, roomID, sessionID)
}

func finalizeEncounter(encounterID, roomID, sessionID string) {
	ctx := context.Background()
	oid, err := primitive.ObjectIDFromHex(encounterID)
	if err != nil {
		return
	}
	var enc models.ResidentEncounter
	if db.Coll(db.CollResidentEncounters).FindOne(ctx, bson.M{"_id": oid}).Decode(&enc) != nil {
		return
	}
	var resident models.ResidentProfile
	_ = db.Coll(db.CollResidentProfiles).FindOne(ctx, bson.M{"_id": enc.ResidentID}).Decode(&resident)

	transcript := buildTranscriptCaregiver(sessionID)
	_, _ = db.Coll(db.CollResidentEncounters).UpdateByID(ctx, oid, bson.M{"$set": bson.M{"conversationTranscript": transcript}})

	// restore cached prompts
	bridgeMu.Lock()
	cc, ok := originalConfigCache[roomID]
	if ok {
		delete(originalConfigCache, roomID)
	}
	bridgeMu.Unlock()
	if ok {
		_, _ = db.Coll(db.CollRoomConfigs).UpdateOne(ctx, bson.M{"roomId": roomID}, bson.M{"$set": bson.M{
			"caregiverPrompt": cc.caregiverPrompt, "patientPrompt": cc.patientPrompt, "noteType": cc.noteType}})
	}

	if resident.NeboUserID > 0 {
		time.Sleep(5 * time.Second)
		notes := GetUserNotes(resident.NeboUserID, enc.FormID)
		if len(notes) > 0 {
			latest := notes[0]
			result := PollNeboResult(resident.NeboUserID, latest.JobID, 5*time.Second, 120*time.Second)
			if result != nil {
				_, _ = db.Coll(db.CollResidentEncounters).UpdateByID(ctx, oid, bson.M{"$set": bson.M{
					"neboJobId": latest.JobID, "neboNoteLogId": latest.NoteLogID, "neboStatus": "completed",
					"noteFields": result.Fields, "transcript": result.Transcript,
					"wordCount": result.WordCount, "tokenCount": result.TokenCount, "waitTime": result.WaitTime}})
			} else {
				_, _ = db.Coll(db.CollResidentEncounters).UpdateByID(ctx, oid, bson.M{"$set": bson.M{
					"neboStatus": "failed", "errorMessage": "Nebo timeout after 120s"}})
			}
		}
	}

	var fresh models.ResidentEncounter
	_ = db.Coll(db.CollResidentEncounters).FindOne(ctx, bson.M{"_id": oid}).Decode(&fresh)
	triggersDetected, triggeredNoteTypes := ScanForTriggers(fresh.NoteFields, transcript, nil)
	if len(triggeredNoteTypes) > 0 {
		_, _ = db.Coll(db.CollSimulationDays).UpdateByID(ctx, enc.SimulationDayID, bson.M{"$push": bson.M{
			"triggeredNotes": bson.M{"$each": triggeredNoteTypes}}})
	}

	RegisterEncounterWithNebo(roomID, sessionID, encounterID)

	completedAt := time.Now()
	_, _ = db.Coll(db.CollResidentEncounters).UpdateByID(ctx, oid, bson.M{"$set": bson.M{
		"triggersDetected": triggersDetected, "triggeredNoteTypes": triggeredNoteTypes,
		"status": "completed", "completedAt": completedAt}})
	_, _ = db.Coll(db.CollSimulationDays).UpdateByID(ctx, enc.SimulationDayID, bson.M{"$push": bson.M{"completedNotes": enc.NoteType}})

	var simDay models.SimulationDay
	if db.Coll(db.CollSimulationDays).FindOne(ctx, bson.M{"_id": enc.SimulationDayID}).Decode(&simDay) == nil {
		if len(simDay.CompletedNotes) >= len(simDay.NoteSequence) {
			summary := fmt.Sprintf("Day %d completed via schedule with %d notes: %s.", simDay.DayIndex, len(simDay.CompletedNotes), strings.Join(simDay.CompletedNotes, ", "))
			_, _ = db.Coll(db.CollSimulationDays).UpdateByID(ctx, enc.SimulationDayID, bson.M{"$set": bson.M{"status": "completed", "summary": summary}})
		}
	}
	logger.ScheduleLog("info", "[ScheduleBridge] Encounter finalized — "+enc.NoteType+" for room "+roomID, nil)
}

// TodaySlot is one entry in the resident's today schedule.
type TodaySlot struct {
	SlotIndex     int    `json:"slotIndex"`
	ScheduledTime string `json:"scheduledTime"`
	NoteType      string `json:"noteType"`
	Status        string `json:"status"`
	EncounterID   string `json:"encounterId,omitempty"`
	CompletedAt   string `json:"completedAt,omitempty"`
}

// TodaySchedule is returned by the /today-schedule endpoint.
type TodaySchedule struct {
	Today    string      `json:"today"`
	DayIndex int         `json:"dayIndex"`
	Slots    []TodaySlot `json:"slots"`
}

// GetTodaySchedule builds the resident's schedule view for today.
func GetTodaySchedule(residentID primitive.ObjectID, slots []SessionSchedule) (TodaySchedule, error) {
	ctx := context.Background()
	var resident models.ResidentProfile
	if err := db.Coll(db.CollResidentProfiles).FindOne(ctx, bson.M{"_id": residentID}).Decode(&resident); err != nil {
		return TodaySchedule{}, err
	}
	dayStart := startOfToday()
	todayStr := dayStart.Format("2006-01-02")

	var day models.SimulationDay
	hasDay := db.Coll(db.CollSimulationDays).FindOne(ctx, bson.M{
		"residentId": residentID, "runDate": bson.M{"$gte": dayStart, "$lt": dayStart.AddDate(0, 0, 1)}}).Decode(&day) == nil

	dayIndex := 1
	dt := "day1"
	if hasDay {
		dayIndex = day.DayIndex
		if dayIndex != 1 {
			dt = "ongoing"
		}
	} else {
		count, _ := db.Coll(db.CollSimulationDays).CountDocuments(ctx, bson.M{"residentId": residentID})
		dayIndex = int(count) + 1
		if dayIndex != 1 {
			dt = "ongoing"
		}
	}
	noteSequence := GetNoteSequence(dt)

	encBySlot := map[int]models.ResidentEncounter{}
	if hasDay {
		cur, _ := db.Coll(db.CollResidentEncounters).Find(ctx, bson.M{"simulationDayId": day.ID})
		var encs []models.ResidentEncounter
		_ = cur.All(ctx, &encs)
		for _, e := range encs {
			encBySlot[e.SlotIndex] = e
		}
	}

	out := TodaySchedule{Today: todayStr, DayIndex: dayIndex}
	for i, sl := range slots {
		scheduledTime := fmt.Sprintf("%02d:%02d", sl.StartHour, sl.StartMinute)
		if len(noteSequence) == 0 {
			out.Slots = append(out.Slots, TodaySlot{SlotIndex: i, ScheduledTime: scheduledTime, NoteType: "—", Status: "no-note"})
			continue
		}
		noteType := noteSequence[i%len(noteSequence)]
		slot := TodaySlot{SlotIndex: i, ScheduledTime: scheduledTime, NoteType: noteType, Status: "upcoming"}
		if e, ok := encBySlot[i]; ok {
			slot.Status = e.Status
			slot.EncounterID = e.ID.Hex()
			if e.CompletedAt != nil {
				slot.CompletedAt = e.CompletedAt.Format(time.RFC3339)
			}
		}
		out.Slots = append(out.Slots, slot)
	}
	return out, nil
}
