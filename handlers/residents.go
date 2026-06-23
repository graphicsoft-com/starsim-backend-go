package handlers

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"starsim/db"
	"starsim/models"
	"starsim/services"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// ListResidents handles GET /api/residents.
func ListResidents(c *gin.Context) {
	ctx := context.Background()
	cur, err := db.Coll(db.CollResidentProfiles).Find(ctx, bson.M{},
		options.Find().SetSort(bson.D{{Key: "name", Value: 1}}))
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	var residents []models.ResidentProfile
	_ = cur.All(ctx, &residents)

	out := []gin.H{}
	for _, r := range residents {
		total, _ := db.Coll(db.CollSimulationDays).CountDocuments(ctx, bson.M{"residentId": r.ID})
		var lastDay models.SimulationDay
		var lastRunDate, lastRunStatus interface{}
		if db.Coll(db.CollSimulationDays).FindOne(ctx, bson.M{"residentId": r.ID},
			options.FindOne().SetSort(bson.D{{Key: "runDate", Value: -1}})).Decode(&lastDay) == nil {
			lastRunDate = lastDay.RunDate.UTC().Format(time.RFC3339)
			lastRunStatus = lastDay.Status
		}
		out = append(out, gin.H{
			"_id": r.ID.Hex(), "name": r.Name, "gender": r.Gender, "age": r.Age,
			"primaryDiagnosis": r.PrimaryDiagnosis, "admissionDate": r.AdmissionDate,
			"patientUuid": r.PatientUUID, "totalDays": total,
			"lastRunDate": lastRunDate, "lastRunStatus": lastRunStatus,
		})
	}
	ok(c, out)
}

// GetResident handles GET /api/residents/:id.
func GetResident(c *gin.Context) {
	oid, err := primitive.ObjectIDFromHex(c.Param("id"))
	if err != nil {
		fail(c, http.StatusNotFound, "Resident not found")
		return
	}
	var r models.ResidentProfile
	if db.Coll(db.CollResidentProfiles).FindOne(context.Background(), bson.M{"_id": oid}).Decode(&r) != nil {
		fail(c, http.StatusNotFound, "Resident not found")
		return
	}
	ok(c, r)
}

// GetResidentDays handles GET /api/residents/:id/days.
func GetResidentDays(c *gin.Context) {
	oid, err := primitive.ObjectIDFromHex(c.Param("id"))
	if err != nil {
		fail(c, http.StatusInternalServerError, "Invalid id")
		return
	}
	ctx := context.Background()
	cur, _ := db.Coll(db.CollSimulationDays).Find(ctx, bson.M{"residentId": oid},
		options.Find().SetSort(bson.D{{Key: "dayIndex", Value: 1}}).SetProjection(bson.M{"promptSnapshot": 0}))
	days := []models.SimulationDay{}
	_ = cur.All(ctx, &days)
	ok(c, days)
}

// GetResidentDay handles GET /api/residents/:id/days/:dayIndex.
func GetResidentDay(c *gin.Context) {
	oid, err := primitive.ObjectIDFromHex(c.Param("id"))
	if err != nil {
		fail(c, http.StatusInternalServerError, "Invalid id")
		return
	}
	dayIndex, _ := strconv.Atoi(c.Param("dayIndex"))
	var day models.SimulationDay
	if db.Coll(db.CollSimulationDays).FindOne(context.Background(),
		bson.M{"residentId": oid, "dayIndex": dayIndex}).Decode(&day) != nil {
		fail(c, http.StatusNotFound, "Simulation day not found")
		return
	}
	ok(c, day)
}

// GetDayEncounters handles GET /api/residents/:id/days/:dayIndex/encounters.
func GetDayEncounters(c *gin.Context) {
	oid, err := primitive.ObjectIDFromHex(c.Param("id"))
	if err != nil {
		fail(c, http.StatusInternalServerError, "Invalid id")
		return
	}
	dayIndex, _ := strconv.Atoi(c.Param("dayIndex"))
	ctx := context.Background()
	var day models.SimulationDay
	if db.Coll(db.CollSimulationDays).FindOne(ctx, bson.M{"residentId": oid, "dayIndex": dayIndex}).Decode(&day) != nil {
		fail(c, http.StatusNotFound, "Simulation day not found")
		return
	}
	cur, _ := db.Coll(db.CollResidentEncounters).Find(ctx, bson.M{"simulationDayId": day.ID},
		options.Find().SetSort(bson.D{{Key: "sequenceIndex", Value: 1}}).
			SetProjection(bson.M{"conversationTranscript": 0, "noteFields": 0}))
	encs := []models.ResidentEncounter{}
	_ = cur.All(ctx, &encs)
	ok(c, encs)
}

// GetEncounter handles GET /api/residents/:id/encounters/:encounterId.
func GetEncounter(c *gin.Context) {
	encID, err := primitive.ObjectIDFromHex(c.Param("encounterId"))
	if err != nil {
		fail(c, http.StatusNotFound, "Encounter not found")
		return
	}
	var enc models.ResidentEncounter
	if db.Coll(db.CollResidentEncounters).FindOne(context.Background(), bson.M{"_id": encID}).Decode(&enc) != nil {
		fail(c, http.StatusNotFound, "Encounter not found")
		return
	}
	if enc.ResidentID.Hex() != c.Param("id") {
		fail(c, http.StatusForbidden, "Access denied")
		return
	}
	ok(c, enc)
}

// GetEncounterOpenMRS handles POST /api/residents/:id/encounters/openmrs.
func GetEncounterOpenMRS(c *gin.Context) {
	var body struct {
		EncounterUUID string `json:"encounterUuid"`
		EncounterID   string `json:"encounterId"`
	}
	_ = c.ShouldBindJSON(&body)
	uuid := body.EncounterUUID
	if uuid == "" && body.EncounterID != "" {
		if oid, err := primitive.ObjectIDFromHex(body.EncounterID); err == nil {
			var enc models.ResidentEncounter
			if db.Coll(db.CollResidentEncounters).FindOne(context.Background(), bson.M{"_id": oid}).Decode(&enc) == nil {
				if enc.ResidentID.Hex() == c.Param("id") {
					uuid = enc.OpenMrsEncounterUUID
				}
			}
		}
	}
	if uuid == "" {
		c.JSON(http.StatusOK, gin.H{"success": true, "encounter": nil})
		return
	}
	enc := services.GetEncounterDetails(uuid)
	c.JSON(http.StatusOK, gin.H{"success": true, "encounter": enc})
}

// GetTodaySchedule handles GET /api/residents/:id/today-schedule.
func GetTodaySchedule(c *gin.Context) {
	oid, err := primitive.ObjectIDFromHex(c.Param("id"))
	if err != nil {
		fail(c, http.StatusBadRequest, "Invalid residentId")
		return
	}
	sched, err := services.GetTodaySchedule(oid, services.Schedulerr().Info().Sessions)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, sched)
}

// RunDay handles POST /api/residents/:id/run-day.
func RunDay(c *gin.Context) {
	oid, err := primitive.ObjectIDFromHex(c.Param("id"))
	if err != nil {
		fail(c, http.StatusBadRequest, "Invalid residentId")
		return
	}
	var body struct {
		DayIndex int `json:"dayIndex"`
	}
	_ = c.ShouldBindJSON(&body)
	ctx := context.Background()
	target := body.DayIndex
	if target == 0 {
		count, _ := db.Coll(db.CollSimulationDays).CountDocuments(ctx, bson.M{"residentId": oid})
		target = int(count) + 1
	}
	running, _ := db.Coll(db.CollSimulationDays).CountDocuments(ctx,
		bson.M{"residentId": oid, "dayIndex": target, "status": "running"})
	if running > 0 {
		fail(c, http.StatusConflict, "Day "+strconv.Itoa(target)+" is already running")
		return
	}
	go func() { _ = services.RunSimulationDay(oid, body.DayIndex) }()
	okStatus(c, http.StatusAccepted, gin.H{"message": "Day " + strconv.Itoa(target) + " simulation started", "dayIndex": target})
}
