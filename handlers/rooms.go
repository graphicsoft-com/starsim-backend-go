package handlers

import (
	"net/http"
	"strings"

	"starsim/services"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
)

// GetAllRoomConfigs handles GET /api/room-config.
func GetAllRoomConfigs(c *gin.Context) {
	configs, err := services.GetAllRoomConfigs()
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, configs)
}

// GetRoomConfig handles GET /api/room-config/:roomId.
func GetRoomConfig(c *gin.Context) {
	rc, err := services.GetRoomConfig(c.Param("roomId"))
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, rc)
}

// UpdateRoomConfig handles PUT /api/room-config/:roomId.
func UpdateRoomConfig(c *gin.Context) {
	roomID := c.Param("roomId")
	var body map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	updatedBy, _ := body["updatedBy"].(string)
	if updatedBy == "" {
		updatedBy = "dashboard"
	}
	newRoomID, _ := body["roomId"].(string)
	delete(body, "updatedBy")
	delete(body, "_id")
	delete(body, "roomId")

	updates := bson.M{}
	for k, v := range body {
		updates[k] = v
	}

	if newRoomID != "" && strings.TrimSpace(newRoomID) != "" && newRoomID != roomID {
		if _, err := services.RenameRoomConfig(roomID, newRoomID, updatedBy); err != nil {
			fail(c, http.StatusBadRequest, err.Error())
			return
		}
		roomID = newRoomID
	}
	if len(updates) > 0 {
		rc, err := services.UpdateRoomConfig(roomID, updates, updatedBy)
		if err != nil {
			fail(c, http.StatusBadRequest, err.Error())
			return
		}
		ok(c, rc)
		return
	}
	rc, err := services.GetRoomConfig(roomID)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	ok(c, rc)
}

// CreateRoomConfig handles POST /api/room-config.
func CreateRoomConfig(c *gin.Context) {
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

// DeleteRoomConfig handles DELETE /api/room-config/:roomId.
func DeleteRoomConfig(c *gin.Context) {
	if err := services.DeleteRoomConfig(c.Param("roomId")); err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
