package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// ResidentProfile mirrors the Mongoose ResidentProfile schema
// (collection: residentprofiles).
type ResidentProfile struct {
	ID               primitive.ObjectID `bson:"_id,omitempty" json:"_id,omitempty"`
	Name             string             `bson:"name" json:"name"`
	PatientUUID      string             `bson:"patientUuid" json:"patientUuid"`
	NeboUserID       int                `bson:"neboUserId" json:"neboUserId"`
	Gender           string             `bson:"gender" json:"gender"`
	Age              int                `bson:"age" json:"age"`
	AdmissionDate    time.Time          `bson:"admissionDate" json:"admissionDate"`
	PrimaryDiagnosis string             `bson:"primaryDiagnosis" json:"primaryDiagnosis"`
	Allergies        string             `bson:"allergies" json:"allergies"`
	CodeStatus       string             `bson:"codeStatus" json:"codeStatus"`
	CurrentMeds      string             `bson:"currentMedications" json:"currentMedications"`
	BaselineSummary  string             `bson:"baselineSummary" json:"baselineSummary"`
	CreatedAt        time.Time          `bson:"createdAt,omitempty" json:"createdAt,omitempty"`
	UpdatedAt        time.Time          `bson:"updatedAt,omitempty" json:"updatedAt,omitempty"`
}
