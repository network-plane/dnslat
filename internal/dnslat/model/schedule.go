package model

// ScheduleType is interval or daily.
type ScheduleType string

const (
	ScheduleInterval ScheduleType = "interval"
	ScheduleDaily    ScheduleType = "daily"
)

// Schedule triggers DNS probe runs.
type Schedule struct {
	ID        string       `json:"id"`
	Name      string       `json:"name"`
	Enabled   bool         `json:"enabled"`
	Type      ScheduleType `json:"type"`
	Every     string       `json:"every,omitempty"`
	TimeOfDay string       `json:"time_of_day,omitempty"`
}
