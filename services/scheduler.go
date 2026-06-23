package services

import (
	"context"
	"fmt"
	"sync"
	"time"

	"starsim/config"
	"starsim/db"
	"starsim/engine"
	"starsim/logger"

	"github.com/robfig/cron/v3"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// SessionSchedule is one recurring session slot.
type SessionSchedule struct {
	StartHour       int `json:"startHour"`
	StartMinute     int `json:"startMinute"`
	DurationMinutes int `json:"durationMinutes"`
}

// ScheduleInfo is the shape the React client expects from /api/schedule.
type ScheduleInfo struct {
	Sessions  []SessionSchedule `json:"sessions"`
	Timezone  string            `json:"timezone"`
	IsRunning bool              `json:"isRunning"`
}

// Scheduler runs cron-based session start/stop jobs.
type Scheduler struct {
	mu       sync.Mutex
	cron     *cron.Cron
	sessions []SessionSchedule
	running  bool
}

var schedulerInst *Scheduler

func defaultSessions() []SessionSchedule {
	out := make([]SessionSchedule, 0, 12)
	for i := 0; i < 12; i++ {
		out = append(out, SessionSchedule{StartHour: 8 + i, StartMinute: 0, DurationMinutes: 5})
	}
	return out
}

// NewScheduler constructs the scheduler with the default 12-slot schedule.
func NewScheduler() *Scheduler {
	schedulerInst = &Scheduler{sessions: defaultSessions()}
	return schedulerInst
}

// Schedulerr returns the singleton scheduler.
func Schedulerr() *Scheduler { return schedulerInst }

// Start registers cron jobs (unless RUN_SCHEDULER is disabled).
func (s *Scheduler) Start() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.running {
		return
	}
	loc, err := time.LoadLocation(getTZ())
	if err != nil {
		loc = time.UTC
	}
	s.cron = cron.New(cron.WithLocation(loc))
	for idx, sess := range s.sessions {
		slot := idx
		startExpr := fmt.Sprintf("%d %d * * *", sess.StartMinute, sess.StartHour)
		total := sess.StartHour*60 + sess.StartMinute + sess.DurationMinutes
		stopHour := (total / 60) % 24
		stopMin := total % 60
		stopExpr := fmt.Sprintf("%d %d * * *", stopMin, stopHour)
		_, _ = s.cron.AddFunc(startExpr, func() { s.runStart(slot) })
		_, _ = s.cron.AddFunc(stopExpr, func() { s.runStop() })
	}
	s.cron.Start()
	s.running = true
	logger.ScheduleLog("info", fmt.Sprintf("[Scheduler] Started — %d sessions/day, timezone: %s", len(s.sessions), getTZ()), nil)
}

// Stop halts all cron jobs.
func (s *Scheduler) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cron != nil {
		s.cron.Stop()
	}
	s.running = false
}

// Info returns the current schedule info snapshot.
func (s *Scheduler) Info() ScheduleInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := make([]SessionSchedule, len(s.sessions))
	copy(cp, s.sessions)
	return ScheduleInfo{Sessions: cp, Timezone: getTZ(), IsRunning: s.running}
}

// Toggle starts or stops the scheduler.
func (s *Scheduler) Toggle() ScheduleInfo {
	s.mu.Lock()
	running := s.running
	s.mu.Unlock()
	if running {
		s.Stop()
	} else {
		s.Start()
	}
	return s.Info()
}

// Update replaces the schedule and restarts cron.
func (s *Scheduler) Update(sessions []SessionSchedule) ScheduleInfo {
	s.Stop()
	s.mu.Lock()
	s.sessions = sessions
	s.mu.Unlock()
	s.Start()
	return s.Info()
}

func (s *Scheduler) runStart(slot int) {
	logger.ScheduleLog("info", fmt.Sprintf("[Schedule] Running scheduled recording START (slot %d)", slot), nil)
	OnScheduledSlotStart(slot)
	var started []string
	for _, roomID := range GetRoomIDs() {
		if engine.IsRoomRunning(roomID) {
			continue
		}
		if sid, err := engine.StartRoomScheduled(roomID, true); err == nil {
			started = append(started, roomID)
			logger.ScheduleLog("info", fmt.Sprintf("%s — started (session: %s)", roomID, sid), nil)
		} else {
			logger.ScheduleLog("warn", fmt.Sprintf("%s — could not start: %v", roomID, err), nil)
		}
	}
	if len(started) > 0 {
		AlertScheduleStarted(started)
	}
}

func (s *Scheduler) runStop() {
	ctx := context.Background()
	cur, err := db.Coll(db.CollSessions).Find(ctx, bson.M{"scheduledStart": true, "status": "active"},
		options.Find().SetProjection(bson.M{"roomId": 1, "sessionId": 1}))
	if err != nil {
		return
	}
	var sessions []struct {
		RoomID    string `bson:"roomId"`
		SessionID string `bson:"sessionId"`
	}
	_ = cur.All(ctx, &sessions)
	if len(sessions) == 0 {
		logger.ScheduleLog("info", "No scheduler-started sessions to stop", nil)
		return
	}
	var stopped []SessionRef
	for _, ss := range sessions {
		if err := engine.StopRoomScheduled(ss.RoomID); err == nil {
			stopped = append(stopped, SessionRef{RoomID: ss.RoomID, SessionID: ss.SessionID})
		}
	}
	if len(stopped) > 0 {
		OnScheduledSlotStop(stopped)
	}
}

func getTZ() string {
	if config.C.TZCron != "" {
		return config.C.TZCron
	}
	return "America/Denver"
}
