package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// HistoryContext is an embedded sub-document of ResidentEncounter.
type HistoryContext struct {
	EncountersUsed     int      `bson:"encountersUsed" json:"encountersUsed"`
	SummaryInjected    string   `bson:"summaryInjected" json:"summaryInjected"`
	SourceEncounterIDs []string `bson:"sourceEncounterIds" json:"sourceEncounterIds"`
}

// NoteField is one structured field of a generated Nebo note.
type NoteField struct {
	Key     string `bson:"key" json:"key"`
	Label   string `bson:"label" json:"label"`
	Content string `bson:"content" json:"content"`
}

// OpenMRSObs is one observation pulled from OpenMRS.
type OpenMRSObs struct {
	UUID    string `bson:"uuid" json:"uuid"`
	Display string `bson:"display" json:"display"`
	Concept string `bson:"concept" json:"concept"`
	Value   string `bson:"value" json:"value"`
}

// ResidentEncounter mirrors the Mongoose ResidentEncounter schema
// (collection: residentencounters).
type ResidentEncounter struct {
	ID                   primitive.ObjectID  `bson:"_id,omitempty" json:"_id,omitempty"`
	ResidentID           primitive.ObjectID  `bson:"residentId" json:"residentId"`
	SimulationDayID      primitive.ObjectID  `bson:"simulationDayId" json:"simulationDayId"`
	PatientUUID          string              `bson:"patientUuid" json:"patientUuid"`
	DayIndex             int                 `bson:"dayIndex" json:"dayIndex"`
	SimulatedDate        time.Time           `bson:"simulatedDate" json:"simulatedDate"`
	SequenceIndex        int                 `bson:"sequenceIndex" json:"sequenceIndex"`
	NoteType             string              `bson:"noteType" json:"noteType"`
	FormID               int                 `bson:"formId" json:"formId"`
	RoomID               string              `bson:"roomId" json:"roomId"`
	SessionID            *primitive.ObjectID `bson:"sessionId,omitempty" json:"sessionId"`
	ConvTranscript       string              `bson:"conversationTranscript" json:"conversationTranscript"`
	CaregiverPrompt      string              `bson:"caregiverPrompt" json:"caregiverPrompt"`
	PatientPrompt        string              `bson:"patientPrompt" json:"patientPrompt"`
	HistoryContext       HistoryContext      `bson:"historyContext" json:"historyContext"`
	NeboJobID            int                 `bson:"neboJobId" json:"neboJobId"`
	NeboNoteLogID        int                 `bson:"neboNoteLogId" json:"neboNoteLogId"`
	NeboStatus           string              `bson:"neboStatus" json:"neboStatus"`
	NoteFields           []NoteField         `bson:"noteFields" json:"noteFields"`
	Transcript           string              `bson:"transcript" json:"transcript"`
	WordCount            int                 `bson:"wordCount" json:"wordCount"`
	TokenCount           int                 `bson:"tokenCount" json:"tokenCount"`
	WaitTime             float64             `bson:"waitTime" json:"waitTime"`
	OpenMrsEncounterUUID string              `bson:"openMrsEncounterUuid" json:"openMrsEncounterUuid"`
	OpenMrsEncounterType string              `bson:"openMrsEncounterType" json:"openMrsEncounterType"`
	OpenMrsObs           []OpenMRSObs        `bson:"openMrsObs" json:"openMrsObs"`
	TriggersDetected     []string            `bson:"triggersDetected" json:"triggersDetected"`
	TriggeredNoteTypes   []string            `bson:"triggeredNoteTypes" json:"triggeredNoteTypes"`
	Status               string              `bson:"status" json:"status"`
	ErrorMessage         string              `bson:"errorMessage" json:"errorMessage"`
	ScheduledAt          *time.Time          `bson:"scheduledAt,omitempty" json:"scheduledAt,omitempty"`
	SlotIndex            int                 `bson:"slotIndex" json:"slotIndex"`
	CreatedAt            time.Time           `bson:"createdAt,omitempty" json:"createdAt,omitempty"`
	CompletedAt          *time.Time          `bson:"completedAt,omitempty" json:"completedAt"`
}
