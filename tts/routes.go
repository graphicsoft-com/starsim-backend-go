package tts

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"starsim/config"
	"starsim/db"
	"starsim/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
)

var toneSpeed = map[string]float64{
	"neutral": 1.0, "cheerful": 1.05, "tired": 0.88, "nostalgic": 0.92,
	"anxious": 1.1, "content": 0.95, "frustrated": 1.08, "lonely": 0.9,
}

const maxXTTSTextLength = 49000

// PiperSynthesize handles POST /api/tts/piper.
func PiperSynthesize(c *gin.Context) {
	var body struct {
		Text        string `json:"text"`
		SpeakerName string `json:"speakerName"`
		Gender      string `json:"gender"`
		RoomID      string `json:"roomId"`
		TurnNumber  int    `json:"turnNumber"`
	}
	_ = c.ShouldBindJSON(&body)
	if strings.TrimSpace(body.Text) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "\"text\" is required"})
		return
	}
	voiceID := resolveVoiceID(body.SpeakerName, body.Gender)
	wav, perr := synthesizePiper(body.Text, voiceID)
	if perr != nil {
		c.JSON(perr.status, perr.body)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Header("X-Piper-Voice", voiceID)
	c.Data(http.StatusOK, "audio/wav", wav)
}

// PiperHealth handles GET /api/tts/piper/health.
func PiperHealth(c *gin.Context) {
	binExists := false
	if _, err := os.Stat(config.C.PiperBin); err == nil {
		binExists = true
	}
	dirExists := false
	if fi, err := os.Stat(config.C.PiperVoicesDir); err == nil && fi.IsDir() {
		dirExists = true
	}
	voices := listPiperVoices()
	available := binExists && dirExists && len(voices) > 0
	status := http.StatusOK
	if !available {
		status = http.StatusServiceUnavailable
	}
	c.JSON(status, gin.H{
		"available": available, "piperBin": config.C.PiperBin, "piperBinExists": binExists,
		"voicesDir": config.C.PiperVoicesDir, "voicesDirExists": dirExists,
		"voiceCount": len(voices), "voices": voices,
	})
}

var ttsHTTP = &http.Client{Timeout: 120 * time.Second}

// XTTSSynthesize handles POST /api/tts (proxy to the XTTS server).
func XTTSSynthesize(c *gin.Context) {
	var body struct {
		Text       string `json:"text"`
		Role       string `json:"role"`
		Tone       string `json:"tone"`
		RoomID     string `json:"roomId"`
		TurnNumber int    `json:"turnNumber"`
	}
	_ = c.ShouldBindJSON(&body)
	if strings.TrimSpace(body.Text) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Validation Failed", "errors": []string{"\"text\" is required"}})
		return
	}
	if body.RoomID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required roomId"})
		return
	}
	text := body.Text
	if len(text) > maxXTTSTextLength {
		text = text[:maxXTTSTextLength]
	}

	var rc models.RoomConfig
	_ = db.Coll(db.CollRoomConfigs).FindOne(context.Background(), bson.M{"roomId": body.RoomID}).Decode(&rc)
	voiceURL := rc.PatientVoiceURL
	if body.Role == "clinician" {
		voiceURL = rc.CaregiverVoiceURL
	}
	if voiceURL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No voice URL configured for role=" + body.Role + " roomId=" + body.RoomID})
		return
	}
	speed := toneSpeed[body.Tone]
	if speed == 0 {
		speed = 1.0
	}
	if config.C.XTTSBaseURL == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "TTS service unavailable", "detail": "All XTTS servers are currently down"})
		return
	}

	payload, _ := json.Marshal(map[string]interface{}{
		"text": text, "language": "en", "speaker_wav": voiceURL,
		"return_format": "binary", "speed": speed,
	})
	url := strings.TrimRight(config.C.XTTSBaseURL, "/") + "/api/synthesize"
	resp, err := ttsHTTP.Post(url, "application/json", bytes.NewReader(payload))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal TTS error", "detail": err.Error()})
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		detail, _ := io.ReadAll(resp.Body)
		c.JSON(http.StatusBadGateway, gin.H{"error": "TTS generation failed", "status": resp.StatusCode, "detail": string(detail)})
		return
	}
	c.Header("Content-Type", "audio/wav")
	c.Header("ngrok-skip-browser-warning", "true")
	c.Status(http.StatusOK)
	_, _ = io.Copy(c.Writer, resp.Body)
}

// XTTSHealth handles GET /api/tts/health.
func XTTSHealth(c *gin.Context) {
	available := config.C.XTTSBaseURL != ""
	status := http.StatusOK
	if !available {
		status = http.StatusServiceUnavailable
	}
	c.JSON(status, gin.H{"available": available, "servers": []gin.H{}})
}
