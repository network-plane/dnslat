package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"dnslat/internal/dnslat/model"
)

type Config struct {
	DataDir            string               `json:"-"`
	// ConfigFile is the absolute path of the JSON file we load/save (schedules, prefs, last_run).
	ConfigFile         string               `json:"-"`
	SaveManualRuns     bool                 `json:"save_manual_runs"`
	DefaultQueryDomain string               `json:"default_query_domain"`
	Schedules          []model.Schedule     `json:"schedules,omitempty"`
	LastRun            map[string]time.Time `json:"last_run,omitempty"`
}

func Default() Config {
	return Config{
		SaveManualRuns:     false,
		DefaultQueryDomain: "example.com",
		Schedules:          nil,
		LastRun:            make(map[string]time.Time),
	}
}

func ResolveConfigPath(configPath string) string {
	if configPath == "" {
		wd, _ := os.Getwd()
		return filepath.Join(wd, "dnslat.config")
	}
	if strings.HasSuffix(configPath, string(filepath.Separator)) || strings.HasSuffix(configPath, "/") {
		return filepath.Join(configPath, "dnslat.config")
	}
	if info, err := os.Stat(configPath); err == nil && info.IsDir() {
		return filepath.Join(configPath, "dnslat.config")
	}
	return configPath
}

func Load(configPath string) (Config, error) {
	cfgPath := ResolveConfigPath(configPath)
	absCfg, _ := filepath.Abs(cfgPath)
	if absCfg == "" {
		absCfg = cfgPath
	}
	f, err := os.Open(cfgPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			cfg := Default()
			cfg.DataDir = filepath.Dir(absCfg)
			cfg.ConfigFile = absCfg
			return cfg, nil
		}
		return Config{}, err
	}
	defer f.Close()
	var fc fileConfig
	if err := json.NewDecoder(f).Decode(&fc); err != nil {
		return Config{}, err
	}
	cfg := Config{
		ConfigFile:         absCfg,
		DataDir:            filepath.Dir(absCfg),
		SaveManualRuns:     fc.SaveManualRuns,
		DefaultQueryDomain: fc.DefaultQueryDomain,
		Schedules:          fc.Schedules,
		LastRun:            fc.LastRun,
	}
	if cfg.LastRun == nil {
		cfg.LastRun = make(map[string]time.Time)
	}
	if cfg.DefaultQueryDomain == "" {
		cfg.DefaultQueryDomain = "example.com"
	}
	return cfg, nil
}

type fileConfig struct {
	SaveManualRuns     bool                 `json:"save_manual_runs"`
	DefaultQueryDomain string               `json:"default_query_domain"`
	Schedules          []model.Schedule     `json:"schedules,omitempty"`
	LastRun            map[string]time.Time `json:"last_run,omitempty"`
}

func Save(cfg Config) error {
	cfgPath := cfg.ConfigFile
	if cfgPath == "" {
		cfgPath = filepath.Join(cfg.DataDir, "dnslat.config")
	}
	dir := filepath.Dir(cfgPath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp := cfgPath + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	fc := fileConfig{
		SaveManualRuns:     cfg.SaveManualRuns,
		DefaultQueryDomain: cfg.DefaultQueryDomain,
		Schedules:          cfg.Schedules,
		LastRun:            cfg.LastRun,
	}
	if err := enc.Encode(fc); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, cfgPath)
}
