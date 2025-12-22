package scheduler

import (
	"encoding/json"
	"net/http"
)

type RulesUpdateResponse struct {
	Status string `json:"status"`
	Count  int    `json:"count"`
}

// HandleSchedulerRules receives scheduling rules (temporary, no DB yet)
func HandleSchedulerRules() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {

		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var incoming []SchedulingRule
		if err := json.NewDecoder(r.Body).Decode(&incoming); err != nil {
			http.Error(w, "Invalid scheduler rules payload", http.StatusBadRequest)
			return
		}

		// Store rules in memory (later replaced by MongoDB)
		SetRules(incoming)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(RulesUpdateResponse{
			Status: "scheduler rules updated",
			Count:  len(incoming),
		})
	}
}
