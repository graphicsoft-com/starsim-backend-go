package config

import (
	"os"
	"path/filepath"
	"strconv"

	"github.com/joho/godotenv"
)

// Config holds every runtime configuration value, loaded once at startup.
type Config struct {
	Port         string
	MongoURI     string
	MongoDBName  string
	InstanceName string
	NodeEnv      string
	AppEnv       string

	TTSMode               string
	SilentModeTurnDelayMS int

	DeepInfraAPIKey string
	OpenAIBaseURL   string
	PublicBaseURL   string
	XTTSBaseURL     string

	GoogleChatWebhookURL string

	MinioEndpoint  string
	MinioAccessKey string
	MinioSecretKey string
	S3BucketName   string

	NeboAPIKey      string
	OpenMRSUsername string
	OpenMRSPassword string

	RunScheduler     bool
	StartAll         bool
	DisableRateLimit bool
	TZCron           string
	FacilityName     string

	VoicesDir      string
	PiperBin       string
	PiperVoicesDir string

	ClientDistPath string
	LogDir         string
	LogLevel       string
}

// C is the package-level singleton config, populated by Load().
var C *Config

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func envBool(key string, def bool) bool {
	if v := os.Getenv(key); v != "" {
		return v == "true" || v == "1"
	}
	return def
}

// Load reads the .env file (server/.env then root .env) and populates C.
func Load() *Config {
	// Mirror the Node env.ts resolution: prefer ./.env, fall back to ../.env
	for _, p := range []string{".env", filepath.Join("..", ".env")} {
		if _, err := os.Stat(p); err == nil {
			_ = godotenv.Load(p)
			break
		}
	}

	mongoURI := env("MONGO_URI", os.Getenv("MONGODB_URI"))
	if mongoURI == "" {
		mongoURI = "mongodb://localhost:27017/starsim"
	}

	c := &Config{
		Port:         env("PORT", "3000"),
		MongoURI:     mongoURI,
		MongoDBName:  deriveDBName(mongoURI),
		InstanceName: env("INSTANCE_NAME", "demo"),
		NodeEnv:      env("NODE_ENV", "production"),
		AppEnv:       env("APP_ENV", "unknown"),

		TTSMode:               env("TTS_MODE", "piper"),
		SilentModeTurnDelayMS: envInt("SILENT_MODE_TURN_DELAY_MS", 150),

		DeepInfraAPIKey: os.Getenv("DEEPINFRA_API_KEY"),
		OpenAIBaseURL:   env("OPEN_AI_BASE_URL", "https://api.deepinfra.com/v1/openai"),
		PublicBaseURL:   os.Getenv("PUBLIC_BASE_URL"),
		XTTSBaseURL:     os.Getenv("XTTS_BASE_URL"),

		GoogleChatWebhookURL: os.Getenv("GOOGLE_CHAT_WEBHOOK_URL"),

		MinioEndpoint:  os.Getenv("MINIO_ENDPOINT"),
		MinioAccessKey: os.Getenv("MINIO_ACCESS_KEY"),
		MinioSecretKey: os.Getenv("MINIO_SECRET_KEY"),
		S3BucketName:   env("S3_BUCKET_NAME", "grex"),

		NeboAPIKey:      os.Getenv("NEBO_API_KEY"),
		OpenMRSUsername: env("OPENMRS_USERNAME", "brandi"),
		OpenMRSPassword: env("OPENMRS_PASSWORD", "Brandi2026"),

		RunScheduler:     envBool("RUN_SCHEDULER", false),
		StartAll:         envBool("START_ALL", false),
		DisableRateLimit: envBool("DISABLE_RATE_LIMIT", false),
		TZCron:           env("TZ_CRON", "America/Denver"),
		FacilityName:     env("FACILITY_NAME", "Sunrise Long Term Care"),

		VoicesDir:      os.Getenv("VOICES_DIR"),
		PiperBin:       env("PIPER_BIN", "assets/piper/piper"),
		PiperVoicesDir: env("PIPER_VOICES_DIR", "assets/piper/voices"),

		ClientDistPath: env("CLIENT_DIST_PATH", "client/dist"),
		LogDir:         env("LOG_DIR", "logs"),
		LogLevel:       env("LOG_LEVEL", "info"),
	}
	C = c
	return c
}

// IsSilentMode reports whether TTS is disabled (silent mode).
func (c *Config) IsSilentMode() bool { return c.TTSMode == "disabled" }

// deriveDBName extracts the database name from a Mongo connection string.
// Defaults to "starsim" when the URI has no path component.
func deriveDBName(uri string) string {
	if name := os.Getenv("MONGO_DB_NAME"); name != "" {
		return name
	}
	// strip scheme
	rest := uri
	for _, pfx := range []string{"mongodb+srv://", "mongodb://"} {
		if len(rest) >= len(pfx) && rest[:len(pfx)] == pfx {
			rest = rest[len(pfx):]
			break
		}
	}
	slash := -1
	for i := 0; i < len(rest); i++ {
		if rest[i] == '/' {
			slash = i
			break
		}
	}
	if slash == -1 || slash == len(rest)-1 {
		return "starsim"
	}
	dbpart := rest[slash+1:]
	for i := 0; i < len(dbpart); i++ {
		if dbpart[i] == '?' {
			dbpart = dbpart[:i]
			break
		}
	}
	if dbpart == "" {
		return "starsim"
	}
	return dbpart
}
