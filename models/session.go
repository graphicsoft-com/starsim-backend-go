package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// Session mirrors the Mongoose Session schema (collection: sessions).
type Session struct {
	ID             primitive.ObjectID `bson:"_id,omitempty" json:"_id,omitempty"`
	SessionID      string             `bson:"sessionId" json:"sessionId"`
	RoomID         string             `bson:"roomId" json:"roomId"`
	Status         string             `bson:"status" json:"status"`
	InstanceName   string             `bson:"instanceName" json:"instanceName"`
	StartTime      time.Time          `bson:"startTime" json:"startTime"`
	EndTime        *time.Time         `bson:"endTime,omitempty" json:"endTime"`
	PatientProfile string             `bson:"patientProfile" json:"patientProfile"`
	PatientName    string             `bson:"patientName,omitempty" json:"patientName,omitempty"`
	ClinicianName  string             `bson:"clinicianName,omitempty" json:"clinicianName,omitempty"`
	MessageCount   int                `bson:"messageCount" json:"messageCount"`
	ScheduledStart bool               `bson:"scheduledStart" json:"scheduledStart"`
	CreatedAt      time.Time          `bson:"createdAt,omitempty" json:"createdAt,omitempty"`
	UpdatedAt      time.Time          `bson:"updatedAt,omitempty" json:"updatedAt,omitempty"`
}
