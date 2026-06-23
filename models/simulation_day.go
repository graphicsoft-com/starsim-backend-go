package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// PromptSnapshot is an embedded sub-document of SimulationDay.
type PromptSnapshot struct {
	FormID          int    `bson:"formId" json:"formId"`
	CaregiverPrompt string `bson:"caregiverPrompt" json:"caregiverPrompt"`
	PatientPrompt   string `bson:"patientPrompt" json:"patientPrompt"`
	PromptVersion   string `bson:"promptVersion" json:"promptVersion"`
}

// SimulationDay mirrors the Mongoose SimulationDay schema
// (collection: simulationdays).
type SimulationDay struct {
	ID             primitive.ObjectID        `bson:"_id,omitempty" json:"_id,omitempty"`
	ResidentID     primitive.ObjectID        `bson:"residentId" json:"residentId"`
	PatientUUID    string                    `bson:"patientUuid" json:"patientUuid"`
	DayIndex       int                       `bson:"dayIndex" json:"dayIndex"`
	SimulatedDate  time.Time                 `bson:"simulatedDate" json:"simulatedDate"`
	RunDate        time.Time                 `bson:"runDate" json:"runDate"`
	Status         string                    `bson:"status" json:"status"`
	NoteSequence   []string                  `bson:"noteSequence" json:"noteSequence"`
	CompletedNotes []string                  `bson:"completedNotes" json:"completedNotes"`
	TriggeredNotes []string                  `bson:"triggeredNotes" json:"triggeredNotes"`
	PromptSnapshot map[string]PromptSnapshot `bson:"promptSnapshot" json:"promptSnapshot"`
	Summary        string                    `bson:"summary" json:"summary"`
	InstanceName   string                    `bson:"instanceName" json:"instanceName"`
	ErrorMessage   string                    `bson:"errorMessage" json:"errorMessage"`
	CreatedAt      time.Time                 `bson:"createdAt,omitempty" json:"createdAt,omitempty"`
	UpdatedAt      time.Time                 `bson:"updatedAt,omitempty" json:"updatedAt,omitempty"`
}
