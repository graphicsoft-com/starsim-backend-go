package handlers

import (
	"net/http"
	"time"

	"starsim/config"

	"github.com/gin-gonic/gin"
)

var startTime = time.Now()

// Health responds to GET /health.
func Health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "ok",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
		"uptime":    int(time.Since(startTime).Seconds()),
	})
}

// Config responds to GET /api/config with instance metadata.
func Config(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"instanceName": config.C.InstanceName,
			"appEnv":       config.C.AppEnv,
			"ttsMode":      config.C.TTSMode,
		},
	})
}
