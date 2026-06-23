package services

import (
	"context"
	"time"

	"starsim/db"
	"starsim/logger"
	"starsim/models"

	"go.mongodb.org/mongo-driver/bson"
)

var residentSeeds = []models.ResidentProfile{
	{
		Name: "Patricia Davis", PatientUUID: UUIDPatriciaDavis, Gender: "female", Age: 79,
		PrimaryDiagnosis: "Mild vascular dementia, recurrent UTIs",
		Allergies:        "Codeine — nausea and vomiting", CodeStatus: "Full Code",
		CurrentMeds: "Donepezil, Metformin, Calcium with Vitamin D",
	},
	{
		Name: "John Brown", PatientUUID: UUIDJohnBrown, Gender: "male", Age: 76,
		PrimaryDiagnosis: "Acute ischemic stroke, right-sided weakness",
		Allergies:        "NKDA", CodeStatus: "Full Code",
		CurrentMeds: "Apixaban, Metoprolol, Atorvastatin, Amlodipine",
	},
	{
		Name: "David Davis", PatientUUID: UUIDDavidDavis, Gender: "male", Age: 84,
		PrimaryDiagnosis: "Right hip fracture post-fall, status post ORIF",
		Allergies:        "Ibuprofen — GI bleed history", CodeStatus: "Full Code",
		CurrentMeds: "Alendronate, Tamsulosin, Lisinopril, Enoxaparin",
	},
	{
		Name: "James Anderson", PatientUUID: UUIDJamesAnderson, Gender: "male", Age: 81,
		PrimaryDiagnosis: "Acute exacerbation of congestive heart failure",
		Allergies:        "Sulfa drugs — hives", CodeStatus: "DNR/DNI",
		CurrentMeds: "Furosemide, Carvedilol, Metformin, Lisinopril, ASA",
	},
	{
		Name: "Barbara Miller", PatientUUID: UUIDBarbaraMiller, Gender: "female", Age: 73,
		PrimaryDiagnosis: "COPD exacerbation with hypoxia",
		Allergies:        "Penicillin — rash", CodeStatus: "Full Code",
		CurrentMeds: "Albuterol, Tiotropium, Lisinopril, Omeprazole",
	},
	{
		Name: "Robert Jones", PatientUUID: UUIDRobertJones, Gender: "male", Age: 88,
		PrimaryDiagnosis: "Severe hypoglycemia, insulin-dependent diabetes",
		Allergies:        "Contrast dye — anaphylaxis", CodeStatus: "DNR",
		CurrentMeds: "Insulin glargine, Insulin lispro, Furosemide, Gabapentin",
	},
}

// SeedResidents idempotently inserts resident profiles (matched by patientUuid).
func SeedResidents() {
	ctx := context.Background()
	seeded, skipped := 0, 0
	for _, r := range residentSeeds {
		count, _ := db.Coll(db.CollResidentProfiles).CountDocuments(ctx, bson.M{"patientUuid": r.PatientUUID})
		if count > 0 {
			skipped++
			continue
		}
		r.NeboUserID = 0
		r.AdmissionDate = time.Now()
		if _, err := db.Coll(db.CollResidentProfiles).InsertOne(ctx, r); err == nil {
			seeded++
		}
	}
	logger.Info("[Residents] 6 resident profiles seeded / already exist (seeded="+itoa(seeded)+", skipped="+itoa(skipped)+")", nil)
}
