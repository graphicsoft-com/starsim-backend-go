package handlers

import (
	"net/http"

	"starsim/services"

	"github.com/gin-gonic/gin"
)

// GetSchedule handles GET /api/schedule (raw ScheduleInfo, no envelope).
func GetSchedule(c *gin.Context) {
	c.JSON(http.StatusOK, services.Schedulerr().Info())
}

// UpdateSchedule handles PUT /api/schedule.
func UpdateSchedule(c *gin.Context) {
	var body struct {
		Sessions []services.SessionSchedule `json:"sessions"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "sessions must be a non-empty array"})
		return
	}
	if len(body.Sessions) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "sessions must be a non-empty array"})
		return
	}
	if len(body.Sessions) > 24 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Too many sessions (max 24)"})
		return
	}
	for _, s := range body.Sessions {
		if s.StartHour < 0 || s.StartHour > 23 || s.StartMinute < 0 || s.StartMinute > 59 || s.DurationMinutes < 1 || s.DurationMinutes > 120 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "startHour 0-23, startMinute 0-59, durationMinutes 1-120"})
			return
		}
	}
	info := services.Schedulerr().Update(body.Sessions)
	c.JSON(http.StatusOK, gin.H{"success": true, "schedule": info})
}

// ToggleSchedule handles POST /api/schedule/toggle.
func ToggleSchedule(c *gin.Context) {
	info := services.Schedulerr().Toggle()
	c.JSON(http.StatusOK, gin.H{"success": true, "schedule": info})
}
