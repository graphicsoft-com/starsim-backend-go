package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// Character mirrors the Mongoose Character schema (collection: characters).
type Character struct {
	ID        primitive.ObjectID `bson:"_id,omitempty" json:"_id,omitempty"`
	Name      string             `bson:"name" json:"name"`
	Role      string             `bson:"role" json:"role"`
	Gender    string             `bson:"gender" json:"gender"`
	Age       *int               `bson:"age" json:"age"`
	Email     string             `bson:"email" json:"email"`
	Profile   string             `bson:"profile" json:"profile"`
	Prompt    string             `bson:"prompt" json:"prompt"`
	CreatedAt time.Time          `bson:"createdAt,omitempty" json:"createdAt,omitempty"`
	UpdatedAt time.Time          `bson:"updatedAt,omitempty" json:"updatedAt,omitempty"`
}

// NoteTypeConfig mirrors the Mongoose NoteTypeConfig schema
// (collection: notetypeconfigs).
type NoteTypeConfig struct {
	ID                       primitive.ObjectID `bson:"_id,omitempty" json:"_id,omitempty"`
	Name                     string             `bson:"name" json:"name"`
	DayType                  string             `bson:"dayType" json:"dayType"`
	Order                    int                `bson:"order" json:"order"`
	RequiresHistory          bool               `bson:"requiresHistory" json:"requiresHistory"`
	HistoryLimit             int                `bson:"historyLimit" json:"historyLimit"`
	NeboFormID               int                `bson:"neboFormId" json:"neboFormId"`
	NotePrompt               string             `bson:"notePrompt" json:"notePrompt"`
	PatientNotePrompt        string             `bson:"patientNotePrompt" json:"patientNotePrompt"`
	UseNotePromptOnly        bool               `bson:"useNotePromptOnly" json:"useNotePromptOnly"`
	UsePatientNotePromptOnly bool               `bson:"usePatientNotePromptOnly" json:"usePatientNotePromptOnly"`
	Enabled                  bool               `bson:"enabled" json:"enabled"`
	CreatedAt                time.Time          `bson:"createdAt,omitempty" json:"createdAt,omitempty"`
	UpdatedAt                time.Time          `bson:"updatedAt,omitempty" json:"updatedAt,omitempty"`
}

// SystemSettings mirrors the Mongoose SystemSettings schema
// (collection: systemsettings).
type SystemSettings struct {
	ID        primitive.ObjectID `bson:"_id,omitempty" json:"_id,omitempty"`
	Key       string             `bson:"key" json:"key"`
	Value     string             `bson:"value" json:"value"`
	CreatedAt time.Time          `bson:"createdAt,omitempty" json:"createdAt,omitempty"`
	UpdatedAt time.Time          `bson:"updatedAt,omitempty" json:"updatedAt,omitempty"`
}
