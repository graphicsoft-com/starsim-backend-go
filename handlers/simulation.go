package handlers

import (
	"context"
	"net/http"
	"time"

	"starsim/db"
	"starsim/engine"
	"starsim/models"
	"starsim/services"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// StartSimulation handles POST /api/simulation/start/:roomId.
func StartSimulation(c *gin.Context) {
	roomID := c.Param("roomId")
	if roomID == "" {
		fail(c, http.StatusBadRequest, "roomId is required")
		return
	}
	if engine.GetRoomStatus(roomID) {
		fail(c, http.StatusConflict, roomID+" is already running")
		return
	}
	var rc models.RoomConfig
	if db.Coll(db.CollRoomConfigs).FindOne(context.Background(), bson.M{"roomId": roomID}).Decode(&rc) != nil {
		fail(c, http.StatusBadRequest, "No configuration found for "+roomID+". Configure the room first.")
		return
	}
	if rc.CaregiverName == "" || rc.CaregiverName == "New Caregiver" {
		fail(c, http.StatusBadRequest, "Select a caregiver for "+roomID+" before starting.")
		return
	}
	if rc.PatientName == "" || rc.PatientName == "New Tenant" {
		fail(c, http.StatusBadRequest, "Select a tenant for "+roomID+" before starting.")
		return
	}
	sessionID, err := engine.StartRoomScheduled(roomID, false)
	if err != nil {
		fail(c, http.StatusInternalServerError, "Failed to start simulation")
		return
	}
	engine.EmitRoomUpdate(roomID, "active")
	okStatus(c, http.StatusCreated, gin.H{"roomId": roomID, "sessionId": sessionID, "status": "active"})
}

// StopSimulation handles POST /api/simulation/stop/:roomId.
func StopSimulation(c *gin.Context) {
	roomID := c.Param("roomId")
	if roomID == "" {
		fail(c, http.StatusBadRequest, "roomId is required")
		return
	}
	if !engine.GetRoomStatus(roomID) {
		fail(c, http.StatusConflict, roomID+" is not running")
		return
	}
	engine.StopRoom(roomID, "manual")
	_, _ = db.Coll(db.CollSessions).UpdateOne(context.Background(),
		bson.M{"roomId": roomID, "status": "active"},
		bson.M{"$set": bson.M{"status": "stopped", "endTime": time.Now()}},
		options.Update())
	engine.EmitRoomUpdate(roomID, "idle")
	ok(c, gin.H{"roomId": roomID, "status": "idle"})
}

// GetAllRoomStatuses handles GET /api/simulation/status.
func GetAllRoomStatuses(c *gin.Context) {
	ctx := context.Background()
	cur, err := db.Coll(db.CollRoomConfigs).Find(ctx, bson.M{}, options.Find().SetSort(bson.D{{Key: "roomId", Value: 1}}))
	if err != nil {
		fail(c, http.StatusInternalServerError, "Failed to get statuses")
		return
	}
	var configs []models.RoomConfig
	_ = cur.All(ctx, &configs)

	rooms := []gin.H{}
	for _, rc := range configs {
		isActive := engine.GetRoomStatus(rc.RoomID)
		var activeSessionID interface{}
		var startTime interface{}
		messageCount := 0
		if isActive {
			var sess models.Session
			if db.Coll(db.CollSessions).FindOne(ctx, bson.M{"roomId": rc.RoomID, "status": "active"},
				options.FindOne().SetSort(bson.D{{Key: "startTime", Value: -1}})).Decode(&sess) == nil {
				activeSessionID = sess.ID.Hex()
				startTime = sess.StartTime.UTC().Format(time.RFC3339)
				messageCount = sess.MessageCount
			}
		}
		status := "idle"
		if isActive {
			status = "active"
		}
		rooms = append(rooms, gin.H{
			"roomId": rc.RoomID, "status": status, "activeSessionId": activeSessionID,
			"startTime": startTime, "messageCount": messageCount, "roomName": rc.RoomName,
			"machineLabel": rc.MachineLabel, "caregiverName": rc.CaregiverName,
			"caregiverMachine": rc.CaregiverMachine, "patientName": rc.PatientName,
			"patientMachine": rc.PatientMachine,
		})
	}
	ok(c, gin.H{"rooms": rooms})
}

// StartAllSimulations handles POST /api/simulation/start-all.
func StartAllSimulations(c *gin.Context) {
	results := []gin.H{}
	for _, roomID := range services.GetRoomIDs() {
		if engine.GetRoomStatus(roomID) {
			results = append(results, gin.H{"roomId": roomID, "success": false, "error": "already running"})
			continue
		}
		sid, err := engine.StartRoomScheduled(roomID, false)
		if err != nil {
			results = append(results, gin.H{"roomId": roomID, "success": false, "error": err.Error()})
			continue
		}
		results = append(results, gin.H{"roomId": roomID, "success": true, "sessionId": sid})
	}
	okStatus(c, http.StatusCreated, gin.H{"results": results})
}

// UpdateRoomConfigPatch handles PATCH /api/simulation/room-config/:roomId.
func UpdateRoomConfigPatch(c *gin.Context) {
	roomID := c.Param("roomId")
	if roomID == "" {
		fail(c, http.StatusBadRequest, "roomId is required")
		return
	}
	var body struct {
		MachineLabel *string `json:"machineLabel"`
	}
	_ = c.ShouldBindJSON(&body)
	update := bson.M{}
	if body.MachineLabel != nil {
		ml := *body.MachineLabel
		if len(ml) > 30 {
			ml = ml[:30]
		}
		update["machineLabel"] = ml
	}
	if len(update) == 0 {
		fail(c, http.StatusBadRequest, "Nothing to update")
		return
	}
	opts := options.FindOneAndUpdate().SetUpsert(true).SetReturnDocument(options.After)
	var rc models.RoomConfig
	if db.Coll(db.CollRoomConfigs).FindOneAndUpdate(context.Background(), bson.M{"roomId": roomID},
		bson.M{"$set": update}, opts).Decode(&rc) != nil {
		fail(c, http.StatusInternalServerError, "Failed to update config")
		return
	}
	ok(c, rc)
}

// CreateRoom handles POST /api/simulation/create-room.
func CreateRoom(c *gin.Context) {
	var body struct {
		RoomID    string `json:"roomId"`
		CreatedBy string `json:"createdBy"`
	}
	_ = c.ShouldBindJSON(&body)
	if body.RoomID == "" {
		fail(c, http.StatusBadRequest, "roomId is required")
		return
	}
	createdBy := body.CreatedBy
	if createdBy == "" {
		createdBy = "dashboard"
	}
	rc, err := services.CreateRoomConfig(body.RoomID, createdBy)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	okStatus(c, http.StatusCreated, rc)
}

// DeleteRoom handles DELETE /api/simulation/delete-room/:roomId.
func DeleteRoom(c *gin.Context) {
	roomID := c.Param("roomId")
	if roomID == "" {
		fail(c, http.StatusBadRequest, "roomId is required")
		return
	}
	if engine.GetRoomStatus(roomID) {
		fail(c, http.StatusConflict, roomID+" is still running. Stop it first.")
		return
	}
	if err := services.DeleteRoomConfig(roomID); err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
