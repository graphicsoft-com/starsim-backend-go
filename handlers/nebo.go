package handlers

import (
	"context"
	"net/http"

	"starsim/config"
	"starsim/db"
	"starsim/models"
	"starsim/services"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// RegisterNebo handles POST /api/nebo/register/:roomId.
func RegisterNebo(c *gin.Context) {
	if config.C.NeboAPIKey == "" {
		fail(c, http.StatusServiceUnavailable, "Nebo integration not configured")
		return
	}
	roomID := c.Param("roomId")
	var sess models.Session
	err := db.Coll(db.CollSessions).FindOne(context.Background(),
		bson.M{"roomId": roomID, "status": "stopped"},
		options.FindOne().SetSort(bson.D{{Key: "endTime", Value: -1}})).Decode(&sess)
	if err != nil {
		fail(c, http.StatusNotFound, "No completed session found for this room")
		return
	}
	defer func() {
		if r := recover(); r != nil {
			fail(c, http.StatusInternalServerError, "Failed to register encounter")
		}
	}()
	go services.RegisterEncounterWithNebo(roomID, sess.SessionID, "")
	c.JSON(http.StatusOK, gin.H{"success": true})
}
