package engine

import (
	"strings"
	"testing"
	"time"
)

func TestBuildSessionID(t *testing.T) {
	tm := time.Date(2026, 5, 7, 14, 30, 0, 0, time.UTC)
	got := BuildSessionID("room1", tm)
	want := "2026-05-07_02-30PM_room1"
	if got != want {
		t.Fatalf("BuildSessionID = %q, want %q", got, want)
	}
	// midnight → 12 AM
	if g := BuildSessionID("room2", time.Date(2026, 1, 2, 0, 5, 0, 0, time.UTC)); g != "2026-01-02_12-05AM_room2" {
		t.Fatalf("midnight session id = %q", g)
	}
}

func TestEstimateTtsDuration(t *testing.T) {
	// very short text clamps to the 15s minimum
	if d := estimateTtsDurationMs("hi"); d != 15000*time.Millisecond {
		t.Fatalf("short text duration = %v, want 15s", d)
	}
	// long text clamps to the 120s maximum
	long := strings.Repeat("word ", 1000)
	if d := estimateTtsDurationMs(long); d != 120000*time.Millisecond {
		t.Fatalf("long text duration = %v, want 120s", d)
	}
}

func TestFlipHistory(t *testing.T) {
	in := []agentMessage{{Role: "assistant", Content: "a"}, {Role: "user", Content: "b"}}
	out := flipHistory(in)
	if out[0].Role != "user" || out[1].Role != "assistant" {
		t.Fatalf("flipHistory roles = %+v", out)
	}
	if out[0].Content != "a" || out[1].Content != "b" {
		t.Fatalf("flipHistory mutated content")
	}
}

func TestPromptHeader(t *testing.T) {
	st := createConversationState("s", "room1")
	p := buildClinicianPrompt("Dr. Smith", "Pat", st)
	if !strings.Contains(p, "━━━ TURN 1 DIRECTIVES ━━━") {
		t.Fatalf("clinician prompt missing turn header: %q", p[:80])
	}
	if !strings.Contains(p, "licensed mental health therapist") {
		t.Fatalf("clinician base prompt missing")
	}
}

func TestConversationStateConcernFlag(t *testing.T) {
	st := createConversationState("s", "room1")
	st.updateStateAfterTurn("patient", "I feel hopeless and alone today")
	if len(st.FlaggedConcerns) == 0 {
		t.Fatalf("expected concern flagged for 'hopeless'")
	}
	if !st.FollowUpDue {
		t.Fatalf("expected FollowUpDue true after concern")
	}
	if st.Turn != 1 {
		t.Fatalf("turn = %d, want 1", st.Turn)
	}
}

func TestUpdatePhase(t *testing.T) {
	st := createConversationState("s", "room1")
	st.Turn = 50
	st.updatePhase()
	if st.Phase != "deep" {
		t.Fatalf("phase at turn 50 = %q, want deep", st.Phase)
	}
}
