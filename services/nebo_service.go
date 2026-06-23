package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
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

const neboBaseURL = "https://nebo.rhanebo.com"

var neboHTTP = &http.Client{Timeout: 30 * time.Second}

var (
	regSessMu        sync.Mutex
	registeredSesses = map[string]bool{}
)

var nonDigit = regexp.MustCompile(`\D`)

// NeboNote is a note record from the Nebo notes API.
type NeboNote struct {
	JobID      int                `json:"job_id"`
	NoteLogID  int                `json:"note_log_id"`
	NoteType   string             `json:"note_type"`
	FormID     int                `json:"form_id"`
	Status     string             `json:"status"`
	WordCount  int                `json:"word_count"`
	TokenCount int                `json:"token_count"`
	Transcript string             `json:"transcript"`
	WaitTime   float64            `json:"wait_time"`
	Fields     []models.NoteField `json:"fields"`
}

// RegisterEncounterWithNebo posts the session transcript to Nebo for note
// generation and stores the returned OpenMRS encounter uuid.
func RegisterEncounterWithNebo(roomID, sessionID, encounterID string) {
	regSessMu.Lock()
	if registeredSesses[sessionID] {
		regSessMu.Unlock()
		logger.Warn("[Nebo] Duplicate registration skipped — already called for this session", nil)
		return
	}
	registeredSesses[sessionID] = true
	regSessMu.Unlock()

	if config.C.NeboAPIKey == "" {
		logger.Warn("[Nebo] NEBO_API_KEY not set — skipping encounter registration", nil)
		return
	}

	ctx := context.Background()
	cur, err := db.Coll(db.CollMessages).Find(ctx, bson.M{"sessionId": sessionID},
		options.Find().SetSort(bson.D{{Key: "timestamp", Value: 1}}))
	if err != nil {
		logger.Error("[Nebo] failed loading messages: "+err.Error(), nil)
		return
	}
	var msgs []models.Message
	_ = cur.All(ctx, &msgs)
	if len(msgs) == 0 {
		logger.Warn("[Nebo] No messages found — skipping encounter registration", nil)
		return
	}

	formID := 1
	var rc models.RoomConfig
	if db.Coll(db.CollRoomConfigs).FindOne(ctx, bson.M{"roomId": roomID}).Decode(&rc) == nil && rc.NeboFormID != 0 {
		formID = rc.NeboFormID
	}

	var b bytes.Buffer
	for i, m := range msgs {
		label := "Clinician"
		if m.Role != "clinician" {
			label = "Patient"
		}
		if i > 0 {
			b.WriteString("\n")
		}
		b.WriteString(label + ": " + m.Text)
	}

	roomNum, _ := strconv.Atoi(nonDigit.ReplaceAllString(roomID, ""))
	payload, _ := json.Marshal(map[string]interface{}{
		"roomId":     roomNum,
		"transcript": b.String(),
		"formID":     formID,
	})

	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, neboBaseURL+"/api/grex/registerEncounter.php", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", config.C.NeboAPIKey)

	resp, err := neboHTTP.Do(req)
	if err != nil {
		logger.Error("[Nebo] registerEncounter error: "+err.Error(), nil)
		AlertNeboRegistered(roomID, sessionID, false, err.Error())
		return
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		logger.Error(fmt.Sprintf("[Nebo] registerEncounter failed — HTTP %d: %s", resp.StatusCode, string(data)), nil)
		AlertNeboRegistered(roomID, sessionID, false, fmt.Sprintf("HTTP %d", resp.StatusCode))
		return
	}

	var parsed struct {
		Success bool `json:"success"`
		Data    struct {
			EncounterUUID string `json:"encounter_uuid"`
			NoteLogID     int    `json:"noteLogID"`
			JobID         int    `json:"jobID"`
		} `json:"data"`
	}
	_ = json.Unmarshal(data, &parsed)

	if parsed.Data.EncounterUUID != "" {
		if encounterID != "" {
			if oid, e := primitive.ObjectIDFromHex(encounterID); e == nil {
				_, _ = db.Coll(db.CollResidentEncounters).UpdateByID(ctx, oid,
					bson.M{"$set": bson.M{"openMrsEncounterUuid": parsed.Data.EncounterUUID}})
			}
		} else {
			startOfDay := time.Now().Truncate(24 * time.Hour)
			_, _ = db.Coll(db.CollResidentEncounters).UpdateOne(ctx,
				bson.M{"roomId": roomID, "createdAt": bson.M{"$gte": startOfDay}},
				bson.M{"$set": bson.M{"openMrsEncounterUuid": parsed.Data.EncounterUUID}},
				options.Update())
		}
		logger.Info("[Nebo] Saved encounter_uuid "+parsed.Data.EncounterUUID+" to ResidentEncounter", nil)
	}

	logger.Info("[Nebo] Encounter registered — session "+sessionID, nil)
	AlertNeboRegistered(roomID, sessionID, true, "")
}

// GetUserNotes fetches recent notes for a Nebo user.
func GetUserNotes(neboUserID, formID int) []NeboNote {
	if config.C.NeboAPIKey == "" || neboUserID == 0 {
		return nil
	}
	payload, _ := json.Marshal(map[string]interface{}{"userID": neboUserID, "limit": 5, "formId": formID})
	req, _ := http.NewRequest(http.MethodPost, neboBaseURL+"/notes/api/getUserNotes.php", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", config.C.NeboAPIKey)
	resp, err := neboHTTP.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	var parsed struct {
		Success bool       `json:"success"`
		Notes   []NeboNote `json:"notes"`
	}
	data, _ := io.ReadAll(resp.Body)
	_ = json.Unmarshal(data, &parsed)
	return parsed.Notes
}

// GetNoteResult fetches a single Nebo note's result.
func GetNoteResult(neboUserID, jobID int) *NeboNote {
	if config.C.NeboAPIKey == "" || neboUserID == 0 {
		return nil
	}
	payload, _ := json.Marshal(map[string]interface{}{"userID": neboUserID, "jobID": jobID})
	req, _ := http.NewRequest(http.MethodPost, neboBaseURL+"/notes/api/getNoteResult.php", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", config.C.NeboAPIKey)
	resp, err := neboHTTP.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	var parsed struct {
		Success bool      `json:"success"`
		Note    *NeboNote `json:"note"`
	}
	data, _ := io.ReadAll(resp.Body)
	_ = json.Unmarshal(data, &parsed)
	return parsed.Note
}

// PollNeboResult polls until a note is Completed or the timeout elapses.
func PollNeboResult(neboUserID, jobID int, interval, max time.Duration) *NeboNote {
	deadline := time.Now().Add(max)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		if time.Now().After(deadline) {
			return nil
		}
		<-ticker.C
		if time.Now().After(deadline) {
			return nil
		}
		note := GetNoteResult(neboUserID, jobID)
		if note != nil && note.Status == "Completed" {
			return note
		}
	}
}
