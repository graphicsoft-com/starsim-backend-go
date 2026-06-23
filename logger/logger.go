// Package logger wraps zerolog to emit JSON identical in shape to the prior
// Winston output: each line is a JSON object with `level`, `message`,
// `timestamp` (ISO8601) plus any flattened meta fields (including `scope`).
package logger

import (
	"os"
	"regexp"

	"github.com/rs/zerolog"
)

var base zerolog.Logger

// Init configures the global logger. Level comes from LOG_LEVEL.
func Init(level string) {
	zerolog.TimeFieldFormat = "2006-01-02T15:04:05.000Z07:00"
	zerolog.TimestampFieldName = "timestamp"
	zerolog.MessageFieldName = "message"
	zerolog.LevelFieldName = "level"

	lvl, err := zerolog.ParseLevel(level)
	if err != nil {
		lvl = zerolog.InfoLevel
	}
	base = zerolog.New(os.Stdout).Level(lvl).With().Timestamp().Logger()
}

// Fields is a convenience type for structured meta.
type Fields map[string]interface{}

func with(e *zerolog.Event, f Fields) *zerolog.Event {
	for k, v := range f {
		e = e.Interface(k, v)
	}
	return e
}

// Info logs at info level with optional meta fields.
func Info(msg string, f Fields)  { with(base.Info(), f).Msg(msg) }
func Warn(msg string, f Fields)  { with(base.Warn(), f).Msg(msg) }
func Error(msg string, f Fields) { with(base.Error(), f).Msg(msg) }
func Debug(msg string, f Fields) { with(base.Debug(), f).Msg(msg) }

// RoomLog mirrors roomLog(roomId, level, message, extra) → adds scope=room.
func RoomLog(roomID, level, msg string, extra Fields) {
	f := Fields{"scope": "room", "roomId": roomID}
	for k, v := range extra {
		f[k] = v
	}
	emit(level, msg, f)
}

// WsLog mirrors wsLog → adds scope=ws.
func WsLog(msg, level string) { emit(level, msg, Fields{"scope": "ws"}) }

// LLMLog adds scope=llm.
func LLMLog(level, msg string, extra Fields) {
	f := Fields{"scope": "llm"}
	for k, v := range extra {
		f[k] = v
	}
	emit(level, msg, f)
}

// ScheduleLog adds scope=schedule.
func ScheduleLog(level, msg string, extra Fields) {
	f := Fields{"scope": "schedule"}
	for k, v := range extra {
		f[k] = v
	}
	emit(level, msg, f)
}

func emit(level, msg string, f Fields) {
	switch level {
	case "error":
		Error(msg, f)
	case "warn":
		Warn(msg, f)
	case "debug":
		Debug(msg, f)
	default:
		Info(msg, f)
	}
}

var credRe = regexp.MustCompile(`//[^@]+@`)

// LogStartupSummary mirrors logStartupSummary — redacts Mongo credentials.
func LogStartupSummary(port, mongoURI, nodeEnv string) {
	safe := credRe.ReplaceAllString(mongoURI, "//***@")
	Info("Server ready", Fields{
		"scope":    "startup",
		"port":     port,
		"mongoUri": safe,
		"nodeEnv":  nodeEnv,
	})
}
