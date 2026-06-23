package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// RoomConfig mirrors the Mongoose RoomConfig schema (collection: roomconfigs).
type RoomConfig struct {
	ID                primitive.ObjectID `bson:"_id,omitempty" json:"_id,omitempty"`
	RoomID            string             `bson:"roomId" json:"roomId"`
	RoomName          string             `bson:"roomName" json:"roomName"`
	MachineLabel      string             `bson:"machineLabel" json:"machineLabel"`
	CaregiverName     string             `bson:"caregiverName" json:"caregiverName"`
	CaregiverGender   string             `bson:"caregiverGender" json:"caregiverGender"`
	CaregiverEmail    string             `bson:"caregiverEmail" json:"caregiverEmail"`
	CaregiverMachine  string             `bson:"caregiverMachine" json:"caregiverMachine"`
	CaregiverProfile  string             `bson:"caregiverProfile" json:"caregiverProfile"`
	CaregiverPrompt   string             `bson:"caregiverPrompt" json:"caregiverPrompt"`
	CaregiverVoiceURL string             `bson:"caregiverVoiceUrl" json:"caregiverVoiceUrl"`
	PatientName       string             `bson:"patientName" json:"patientName"`
	PatientGender     string             `bson:"patientGender" json:"patientGender"`
	PatientMachine    string             `bson:"patientMachine" json:"patientMachine"`
	PatientAge        int                `bson:"patientAge" json:"patientAge"`
	PatientProfile    string             `bson:"patientProfile" json:"patientProfile"`
	PatientPrompt     string             `bson:"patientPrompt" json:"patientPrompt"`
	PatientVoiceURL   string             `bson:"patientVoiceUrl" json:"patientVoiceUrl"`
	TTSProvider       string             `bson:"ttsProvider" json:"ttsProvider"`
	NoteType          string             `bson:"noteType" json:"noteType"`
	NeboFormID        int                `bson:"neboFormId" json:"neboFormId"`
	UpdatedAt         time.Time          `bson:"updatedAt" json:"updatedAt"`
	UpdatedBy         string             `bson:"updatedBy" json:"updatedBy"`
	CreatedAt         time.Time          `bson:"createdAt,omitempty" json:"createdAt,omitempty"`
}
