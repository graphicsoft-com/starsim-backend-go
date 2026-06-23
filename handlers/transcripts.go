package handlers

import (
	"context"
	"net/http"
	"strconv"

	"starsim/db"
	"starsim/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func pagination(page, limit int, total int64, returned int, skip int) gin.H {
	totalPages := int((total + int64(limit) - 1) / int64(limit))
	return gin.H{
		"page": page, "limit": limit, "total": total,
		"totalPages": totalPages, "hasMore": int64(skip+returned) < total,
	}
}

// GetRoomSessions handles GET /api/transcripts/:id (sessions for a room).
func GetRoomSessions(c *gin.Context) {
	roomID := c.Param("id")
	if roomID == "" {
		fail(c, http.StatusBadRequest, "roomId is required")
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "10"))
	if limit < 1 {
		limit = 10
	}
	skip := (page - 1) * limit
	ctx := context.Background()
	total, _ := db.Coll(db.CollSessions).CountDocuments(ctx, bson.M{"roomId": roomID})
	cur, err := db.Coll(db.CollSessions).Find(ctx, bson.M{"roomId": roomID},
		options.Find().SetSort(bson.D{{Key: "startTime", Value: -1}}).SetSkip(int64(skip)).SetLimit(int64(limit)))
	if err != nil {
		fail(c, http.StatusInternalServerError, "Failed to fetch sessions")
		return
	}
	sessions := []models.Session{}
	_ = cur.All(ctx, &sessions)
	ok(c, gin.H{"sessions": sessions, "pagination": pagination(page, limit, total, len(sessions), skip)})
}

// GetSessionMessages handles GET /api/transcripts/:id/messages.
func GetSessionMessages(c *gin.Context) {
	id := c.Param("id")
	oid, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		fail(c, http.StatusNotFound, "Session not found")
		return
	}
	ctx := context.Background()
	var sess models.Session
	if db.Coll(db.CollSessions).FindOne(ctx, bson.M{"_id": oid}).Decode(&sess) != nil {
		fail(c, http.StatusNotFound, "Session not found")
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	if limit < 1 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	skip := (page - 1) * limit
	total, _ := db.Coll(db.CollMessages).CountDocuments(ctx, bson.M{"sessionId": sess.SessionID})
	cur, _ := db.Coll(db.CollMessages).Find(ctx, bson.M{"sessionId": sess.SessionID},
		options.Find().SetSort(bson.D{{Key: "timestamp", Value: 1}}).SetSkip(int64(skip)).SetLimit(int64(limit)))
	msgs := []models.Message{}
	_ = cur.All(ctx, &msgs)
	ok(c, gin.H{"session": sess, "messages": msgs, "pagination": pagination(page, limit, total, len(msgs), skip)})
}
