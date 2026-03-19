package model

import "time"

type Resolver struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Address   string `json:"address"`
	Builtin   bool   `json:"builtin"`
	SortOrder int    `json:"sort_order"`
	Enabled   bool   `json:"enabled"`
}

type RunResult struct {
	ResolverID  string  `json:"resolver_id"`
	ResolverName string `json:"resolver_name,omitempty"`
	LatencyMs   float64 `json:"latency_ms"`
	Rcode       int     `json:"rcode"`
	AnswerCount int     `json:"answer_count"`
	TTLMin      int     `json:"ttl_min,omitempty"`
	DetailsJSON string  `json:"details_json,omitempty"`
}

type Run struct {
	ID           string      `json:"id"`
	Timestamp    time.Time   `json:"timestamp"`
	QueryDomain  string      `json:"query_domain"`
	Results      []RunResult `json:"results"`
}
