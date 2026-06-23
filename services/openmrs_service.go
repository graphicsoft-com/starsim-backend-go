package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"starsim/config"
	"starsim/db"
	"starsim/logger"
	"starsim/models"

	"go.mongodb.org/mongo-driver/bson"
)

// Known patient UUIDs (used as reference constants).
const (
	UUIDPatriciaDavis = "861da9ec-d2c0-46b7-bf64-41ddb7940a8e"
	UUIDJohnBrown     = "c9cfa26c-4cee-4b22-9495-5336bad3fd1e"
	UUIDDavidDavis    = "573c2f48-7521-4ca4-8433-a192fd173501"
	UUIDJamesAnderson = "8f6fb51a-755e-43ef-a161-9a45bc6b5ab7"
	UUIDBarbaraMiller = "693cae49-71c7-4adf-80c4-dc679ca41db8"
	UUIDRobertJones   = "f3e784d3-09e7-46a3-8d24-517f74343b4a"
)

const neboAPIKeyDefault = "3k7uSiRXN3Vazgbh"

var openmrsHTTP = &http.Client{Timeout: 30 * time.Second}

// OpenMRSEncounter is a summary encounter from OpenMRS.
type OpenMRSEncounter struct {
	UUID              string              `json:"uuid"`
	Display           string              `json:"display"`
	EncounterDatetime string              `json:"encounterDatetime"`
	EncounterType     string              `json:"encounterType"`
	Location          string              `json:"location"`
	Obs               []models.OpenMRSObs `json:"obs"`
}

func openmrsCreds() (string, string) {
	return config.C.OpenMRSUsername, config.C.OpenMRSPassword
}

// GetPatientEncounters fetches recent encounters for a patient (no API key,
// authenticates via username/password body).
func GetPatientEncounters(patientUUID string, limit int) []OpenMRSEncounter {
	u, p := openmrsCreds()
	payload, _ := json.Marshal(map[string]interface{}{
		"username": u, "password": p, "patientUuid": patientUUID, "limit": limit,
	})
	req, _ := http.NewRequest(http.MethodPost, neboBaseURL+"/api/grex/getPatientEncounters.php", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	resp, err := openmrsHTTP.Do(req)
	if err != nil {
		logger.Warn("[ContextBuilder] getPatientEncounters error: "+err.Error(), nil)
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		logger.Warn(fmt.Sprintf("[ContextBuilder] getPatientEncounters failed — HTTP %d", resp.StatusCode), nil)
		return nil
	}
	var parsed struct {
		Success    bool               `json:"success"`
		Encounters []OpenMRSEncounter `json:"encounters"`
	}
	data, _ := io.ReadAll(resp.Body)
	_ = json.Unmarshal(data, &parsed)
	return parsed.Encounters
}

// GetEncounterDetails fetches one encounter's full observation set.
func GetEncounterDetails(encounterUUID string) *OpenMRSEncounter {
	u, p := openmrsCreds()
	apiKey := config.C.NeboAPIKey
	if apiKey == "" {
		apiKey = neboAPIKeyDefault
	}
	payload, _ := json.Marshal(map[string]interface{}{
		"username": u, "password": p, "encounterUuid": encounterUUID,
	})
	req, _ := http.NewRequest(http.MethodPost, neboBaseURL+"/api/grex/getEncounterDetails.php", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		req.Header.Set("X-API-Key", apiKey)
	}
	resp, err := openmrsHTTP.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil
	}
	var parsed struct {
		Success   bool              `json:"success"`
		Encounter *OpenMRSEncounter `json:"encounter"`
	}
	data, _ := io.ReadAll(resp.Body)
	_ = json.Unmarshal(data, &parsed)
	return parsed.Encounter
}

func formatOpenMRSDate(dateStr string) string {
	t, err := time.Parse(time.RFC3339, dateStr)
	if err != nil {
		// try a looser layout
		t, err = time.Parse("2006-01-02 15:04:05", dateStr)
		if err != nil {
			return dateStr
		}
	}
	return t.Format("Jan 02, 2006")
}

// BuildHistoryContext assembles a resident-history summary for note prompts.
func BuildHistoryContext(patientUUID, noteType string, existingEncounterIDs []string) models.HistoryContext {
	empty := models.HistoryContext{SourceEncounterIDs: []string{}}
	ctx := context.Background()

	var ntc models.NoteTypeConfig
	err := db.Coll(db.CollNoteTypeConfigs).FindOne(ctx, bson.M{"name": noteType}).Decode(&ntc)
	if err != nil || !ntc.RequiresHistory {
		return empty
	}
	limit := ntc.HistoryLimit
	if limit == 0 {
		limit = 3
	}
	if limit == 0 {
		return empty
	}

	encs := GetPatientEncounters(patientUUID, limit)
	if len(encs) == 0 {
		return empty
	}
	var detailed []*OpenMRSEncounter
	var uuids []string
	for _, e := range encs {
		d := GetEncounterDetails(e.UUID)
		if d != nil {
			detailed = append(detailed, d)
			uuids = append(uuids, d.UUID)
		}
	}
	if len(detailed) == 0 {
		return empty
	}

	summary := "Resident history from recent encounters:\n\n"
	for _, e := range detailed {
		summary += fmt.Sprintf("From %s on %s:\n", e.EncounterType, formatOpenMRSDate(e.EncounterDatetime))
		for _, o := range e.Obs {
			summary += fmt.Sprintf("- %s: %s\n", o.Concept, o.Value)
		}
		summary += "\n"
	}

	// resolve source encounter ids
	var sourceIDs []string
	if len(uuids) > 0 {
		cur, _ := db.Coll(db.CollResidentEncounters).Find(ctx,
			bson.M{"openMrsEncounterUuid": bson.M{"$in": uuids}})
		if cur != nil {
			var docs []struct {
				ID interface{} `bson:"_id"`
			}
			_ = cur.All(ctx, &docs)
			for _, d := range docs {
				sourceIDs = append(sourceIDs, fmt.Sprintf("%v", d.ID))
			}
		}
	}
	seen := map[string]bool{}
	merged := []string{}
	for _, id := range append(sourceIDs, existingEncounterIDs...) {
		if !seen[id] {
			seen[id] = true
			merged = append(merged, id)
		}
	}

	return models.HistoryContext{
		EncountersUsed:     len(detailed),
		SummaryInjected:    summary,
		SourceEncounterIDs: merged,
	}
}
