package handlers

import (
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"starsim/services"

	"github.com/gin-gonic/gin"
)

func speakerSuffix(speakerName string) string {
	if speakerName == "" {
		return ""
	}
	return "_" + strings.ReplaceAll(strings.ToLower(speakerName), " ", "-")
}

func handleAudioUpload(c *gin.Context) {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		fail(c, http.StatusBadRequest, "No file received")
		return
	}
	roomID := c.PostForm("roomId")
	sessionID := c.PostForm("sessionId")
	role := c.PostForm("role")
	if roomID == "" || sessionID == "" || role == "" {
		fail(c, http.StatusBadRequest, "roomId, sessionId and role are required")
		return
	}
	speakerName := c.PostForm("speakerName")
	turnNumber := c.PostForm("turnNumber")

	f, err := fileHeader.Open()
	if err != nil {
		fail(c, http.StatusInternalServerError, "Failed to read file")
		return
	}
	defer f.Close()
	data, err := io.ReadAll(f)
	if err != nil {
		fail(c, http.StatusInternalServerError, "Failed to read file")
		return
	}

	ts := time.Now().UnixMilli()
	suffix := speakerSuffix(speakerName)
	var key string
	if turnNumber != "" {
		if n, e := strconv.Atoi(turnNumber); e == nil {
			key = fmt.Sprintf("audio/%s/%s/turns/turn_%05d_%s%s_%d.wav", roomID, sessionID, n, role, suffix, ts)
		}
	}
	if key == "" {
		key = fmt.Sprintf("audio/%s/%s/%s%s_%d.wav", roomID, sessionID, role, suffix, ts)
	}

	mime := fileHeader.Header.Get("Content-Type")
	if mime == "" {
		mime = "audio/wav"
	}
	res, err := services.UploadBuffer(key, data, mime)
	if err != nil {
		msg := err.Error()
		if msg == "" {
			msg = "Upload failed"
		}
		fail(c, http.StatusInternalServerError, msg)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "key": res.Key, "url": res.URL, "sizeMb": res.SizeMb})
}

// UploadAudio handles POST /api/audio/upload.
func UploadAudio(c *gin.Context) { handleAudioUpload(c) }

// UploadSessionAudio handles POST /api/audio/upload-session.
func UploadSessionAudio(c *gin.Context) { handleAudioUpload(c) }

// MergedSessionAudio handles GET /api/audio/session/:roomId/:sessionId/merged.
func MergedSessionAudio(c *gin.Context) {
	roomID := c.Param("roomId")
	sessionID := c.Param("sessionId")
	res, err := services.MergeSessionAudio(roomID, sessionID, 2500)
	if err != nil {
		if strings.Contains(err.Error(), "No turn audio files") {
			fail(c, http.StatusNotFound, "No recordings found for this session")
			return
		}
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.Header("Content-Type", "audio/wav")
	c.Header("Content-Length", strconv.Itoa(len(res.Buffer)))
	c.Header("Content-Disposition", fmt.Sprintf("inline; filename=\"session-%s-%s-combined.wav\"", roomID, sessionID))
	c.Header("Accept-Ranges", "bytes")
	c.Header("X-Merged-Key", res.Key)
	c.Header("X-Merged-Url", res.URL)
	c.Data(http.StatusOK, "audio/wav", res.Buffer)
}

// ListSessionAudio handles GET /api/audio/session/:roomId/:sessionId.
func ListSessionAudio(c *gin.Context) {
	roomID := c.Param("roomId")
	sessionID := c.Param("sessionId")
	if roomID == "" || sessionID == "" {
		fail(c, http.StatusBadRequest, "roomId and sessionId are required")
		return
	}
	files, err := services.ListSessionAudio(roomID, sessionID)
	if err != nil {
		msg := err.Error()
		if msg == "" {
			msg = "Failed to list audio"
		}
		fail(c, http.StatusInternalServerError, msg)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "files": files})
}
