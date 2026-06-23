package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"starsim/config"
	"starsim/logger"
)

// AlertService serializes Google Chat webhook posts through a buffered queue to
// avoid 429s (1 message / 1.2s).
type AlertService struct {
	webhookURL string
	queue      chan string
}

var alerts *AlertService

// RoomSummary is one row in the daily status report.
type RoomSummary struct {
	RoomID string
	Active bool
	Turns  int
}

// OnSessionEndedNaturally is invoked by alertSessionStopped for natural endings.
// Wired by the schedule bridge to avoid an import cycle.
var OnSessionEndedNaturally func(roomID, sessionID string)

// InitAlerts constructs the singleton alert service and starts its worker.
func InitAlerts(webhookURL string) {
	alerts = &AlertService{webhookURL: webhookURL, queue: make(chan string, 100)}
	go alerts.processQueue()
}

func (a *AlertService) processQueue() {
	for msg := range a.queue {
		a.sendToChat(msg)
		time.Sleep(1200 * time.Millisecond)
	}
}

func (a *AlertService) send(msg string) {
	select {
	case a.queue <- msg:
	default:
		logger.Warn("[Alerts] Queue full — dropping alert", nil)
	}
}

func envLabel() string {
	if strings.ToLower(config.C.AppEnv) == "live" {
		return "🔴 *[LIVE]*"
	}
	return "🟡 *[STAGE]*"
}

func (a *AlertService) sendToChat(text string) {
	if a.webhookURL == "" {
		logger.Warn("[Alerts] GOOGLE_CHAT_WEBHOOK_URL not set — skipping alert", nil)
		return
	}
	body, _ := json.Marshal(map[string]string{"text": envLabel() + "\n" + text})
	resp, err := http.Post(a.webhookURL, "application/json", bytes.NewReader(body))
	if err != nil {
		logger.Warn("[Alerts] Failed to send alert: "+err.Error(), nil)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		logger.Warn(fmt.Sprintf("[Alerts] Chat webhook failed — HTTP %d", resp.StatusCode), nil)
		return
	}
	logger.Info("[Alerts] Sent to Google Chat", nil)
}

func mountainTime() string {
	loc, err := time.LoadLocation("America/Denver")
	if err != nil {
		loc = time.UTC
	}
	return time.Now().In(loc).Format("03:04 PM")
}

func formatDuration(ms int64) string {
	totalSec := ms / 1000
	h := totalSec / 3600
	m := (totalSec % 3600) / 60
	sec := totalSec % 60
	if h > 0 {
		return fmt.Sprintf("%dh %dm", h, m)
	}
	if m > 0 {
		return fmt.Sprintf("%dm %ds", m, sec)
	}
	return fmt.Sprintf("%ds", sec)
}

func sliceStr(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// AlertSessionStarted notifies that a room session began.
func AlertSessionStarted(roomID, sessionID string) {
	if alerts == nil {
		return
	}
	alerts.send(fmt.Sprintf("🟢 *%s started* — %s MT\n🔑 Session: `%s`", roomID, mountainTime(), sessionID))
}

// AlertSessionStopped notifies that a room session ended.
func AlertSessionStopped(roomID, sessionID string, startTime time.Time, turns int, reason string) {
	reasonText := "🛑 Stopped"
	switch reason {
	case "scheduled":
		reasonText = "⏰ Scheduled stop"
	case "manual":
		reasonText = "🛑 Stopped manually"
	case "oid_disconnected":
		reasonText = "📵 Oid machine disconnected"
	case "completed":
		reasonText = "✅ Completed all turns"
	case "server_restart":
		reasonText = "🔄 Server restarted"
	case "simulation_ended":
		reasonText = "🎓 Simulation completed — agents concluded the conversation"
	}
	durMs := time.Since(startTime).Milliseconds()
	if alerts != nil {
		alerts.send(fmt.Sprintf("🔴 *%s stopped* — %s MT\n%s\n⏱️ Duration: *%s*\n💬 Turns completed: *%d*\n🔑 Session: `%s`",
			roomID, mountainTime(), reasonText, formatDuration(durMs), turns, sessionID))
	}
	if (reason == "simulation_ended" || reason == "completed") && OnSessionEndedNaturally != nil {
		go OnSessionEndedNaturally(roomID, sessionID)
	}
}

// AlertOidDisconnected notifies that an Oid machine dropped mid-session.
func AlertOidDisconnected(roomID, role string, turn int) {
	if alerts == nil {
		return
	}
	alerts.send(fmt.Sprintf("📵 *Oid machine disconnected* — %s MT\n📍 %s — (%s)\n🔢 At turn %d\n⚠️ Session may have stopped. Check the dashboard.",
		mountainTime(), roomID, role, turn))
}

// AlertDailySummary posts the 6 AM daily status report.
func AlertDailySummary(date string, rooms []RoomSummary) {
	if alerts == nil {
		return
	}
	activeCount := 0
	totalTurns := 0
	var lines []string
	for _, r := range rooms {
		totalTurns += r.Turns
		dot, st := "🔴", "Down"
		if r.Active {
			activeCount++
			dot, st = "🟢", "Running"
		}
		lines = append(lines, fmt.Sprintf("%s %s: *%s* · %s turns today", dot, r.RoomID, st, groupThousands(r.Turns)))
	}
	msg := fmt.Sprintf("📊 *Daily Status Report — %s*\n\n🏠 Active machines: *%d/6*\n💬 Total turns today: *%s*\n\n*Machine status:*\n%s",
		date, activeCount, groupThousands(totalTurns), strings.Join(lines, "\n"))
	alerts.send(msg)
}

// AlertServerCrash notifies of an unrecoverable server error.
func AlertServerCrash(errMsg string) {
	if alerts == nil {
		return
	}
	alerts.send(fmt.Sprintf("🔴 *SERVER CRASH — %s MT*\n\n```\n%s\n```\n\n⚠️ Sessions may have stopped. Check Smokey immediately.",
		mountainTime(), sliceStr(errMsg, 500)))
}

// AlertScheduleStarted notifies that the scheduler launched a session slot.
func AlertScheduleStarted(startedRooms []string) {
	if alerts == nil {
		return
	}
	alerts.send(fmt.Sprintf("🗓️ *Scheduled session started* — %s MT\n🟢 Started: *%s*",
		mountainTime(), strings.Join(startedRooms, ", ")))
}

// AlertNeboRegistered notifies of a Nebo EHR registration outcome.
func AlertNeboRegistered(roomID, sessionID string, success bool, errorMessage string) {
	if alerts == nil {
		return
	}
	if success {
		alerts.send(fmt.Sprintf("📋 *Nebo EHR registered* — %s MT\n📍 Room: *%s*\n🔑 Session: `%s`\n✅ Notes sent for generation",
			mountainTime(), roomID, sessionID))
		return
	}
	if errorMessage == "" {
		errorMessage = "Unknown error"
	}
	alerts.send(fmt.Sprintf("❌ *Nebo EHR registration failed* — %s MT\n📍 Room: *%s*\n🔑 Session: `%s`\n💬 Error: `%s`",
		mountainTime(), roomID, sessionID, sliceStr(errorMessage, 300)))
}

// AlertTTSError notifies of a TTS failure reported by an Oid machine.
func AlertTTSError(roomID, role, errMsg string) {
	if alerts == nil {
		return
	}
	alerts.send(fmt.Sprintf("⚠️ *TTS Error* — %s MT\n📍 %s — (%s)\n`%s`",
		mountainTime(), roomID, role, sliceStr(errMsg, 300)))
}

// groupThousands formats an int with comma separators (en-US style).
func groupThousands(n int) string {
	s := fmt.Sprintf("%d", n)
	neg := strings.HasPrefix(s, "-")
	if neg {
		s = s[1:]
	}
	var out []byte
	for i, c := range []byte(s) {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, ',')
		}
		out = append(out, c)
	}
	if neg {
		return "-" + string(out)
	}
	return string(out)
}
