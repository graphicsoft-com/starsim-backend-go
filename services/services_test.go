package services

import (
	"testing"

	"starsim/config"
	"starsim/models"
)

func TestScanForTriggersPain(t *testing.T) {
	fields := []models.NoteField{{Key: "assessment", Content: "Patient reports pain 8/10 in left hip"}}
	det, types := ScanForTriggers(fields, "", nil)
	if len(types) == 0 || types[0] != "SBAR Note" {
		t.Fatalf("expected SBAR Note trigger, got %v", types)
	}
	if len(det) == 0 || det[0] != "pain_high" {
		t.Fatalf("expected pain_high, got %v", det)
	}
}

func TestScanForTriggersFall(t *testing.T) {
	_, types := ScanForTriggers(nil, "the resident fell in the bathroom", nil)
	found := false
	for _, ty := range types {
		if ty == "Incident/Event Note" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected Incident/Event Note from 'fell', got %v", types)
	}
}

func TestScanForTriggersNoPainWithoutScore(t *testing.T) {
	fields := []models.NoteField{{Content: "patient has some pain but mild"}}
	_, types := ScanForTriggers(fields, "", nil)
	for _, ty := range types {
		if ty == "SBAR Note" {
			t.Fatalf("should not trigger SBAR without a 7-10/10 score")
		}
	}
}

func TestResolvePromptTokens(t *testing.T) {
	config.Load()
	out := ResolvePromptTokens("Hi {{CAREGIVER_NAME}}, see {{RESIDENT_NAME}} for {{NOTE_TYPE}} at {{FACILITY_NAME}}",
		map[string]string{"caregiverName": "Dan", "residentName": "Pat", "noteType": "SBAR", "facilityName": "Acme"})
	want := "Hi Dan, see Pat for SBAR at Acme"
	if out != want {
		t.Fatalf("ResolvePromptTokens = %q, want %q", out, want)
	}
}

func TestWavRoundTrip(t *testing.T) {
	pcm := make([]byte, 800)
	for i := range pcm {
		pcm[i] = byte(i % 251)
	}
	wav := BuildPcmWav(pcm, 22050, 1, 16)
	if len(wav) != 44+len(pcm) {
		t.Fatalf("wav length = %d, want %d", len(wav), 44+len(pcm))
	}
	if string(wav[0:4]) != "RIFF" || string(wav[8:12]) != "WAVE" {
		t.Fatalf("bad RIFF/WAVE header")
	}
	parsed := parsePcmWav(wav)
	if parsed.sampleRate != 22050 || parsed.channels != 1 || parsed.bitsPerSample != 16 {
		t.Fatalf("parsed header mismatch: %+v", parsed)
	}
	if len(parsed.pcm) != len(pcm) {
		t.Fatalf("parsed pcm length = %d, want %d", len(parsed.pcm), len(pcm))
	}
}

func TestFormatDurationAndThousands(t *testing.T) {
	if formatDuration(3_725_000) != "1h 2m" {
		t.Fatalf("formatDuration hours = %q", formatDuration(3_725_000))
	}
	if formatDuration(65_000) != "1m 5s" {
		t.Fatalf("formatDuration minutes = %q", formatDuration(65_000))
	}
	if groupThousands(1234567) != "1,234,567" {
		t.Fatalf("groupThousands = %q", groupThousands(1234567))
	}
}

func TestSeedDataCounts(t *testing.T) {
	if len(defaultRoomConfigs) != 6 {
		t.Fatalf("room configs = %d, want 6", len(defaultRoomConfigs))
	}
	if len(defaultCharacters) != 12 {
		t.Fatalf("characters = %d, want 12", len(defaultCharacters))
	}
	if len(residentSeeds) != 6 {
		t.Fatalf("residents = %d, want 6", len(residentSeeds))
	}
}
