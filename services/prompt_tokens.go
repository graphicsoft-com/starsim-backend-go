package services

import (
	"strings"

	"starsim/config"
)

// ResolvePromptTokens substitutes {{CAREGIVER_NAME}}, {{RESIDENT_NAME}},
// {{NOTE_TYPE}}, and {{FACILITY_NAME}} placeholders in a prompt.
func ResolvePromptTokens(prompt string, vars map[string]string) string {
	facility := vars["facilityName"]
	if facility == "" {
		facility = config.C.FacilityName
	}
	if facility == "" {
		facility = "Sunrise Long Term Care"
	}
	r := strings.NewReplacer(
		"{{CAREGIVER_NAME}}", vars["caregiverName"],
		"{{RESIDENT_NAME}}", vars["residentName"],
		"{{NOTE_TYPE}}", vars["noteType"],
		"{{FACILITY_NAME}}", facility,
	)
	return r.Replace(prompt)
}
