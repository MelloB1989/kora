// Package config loads runtime configuration from the environment via
// karma/config (github.com/MelloB1989/karma — see the licensing note in the
// repo README; swapping this file to plain os.Getenv removes the dependency).
package config

import (
	kconfig "github.com/MelloB1989/karma/config"
)

type Config struct {
	// JWTSecret signs/verifies HS256 auth tokens. Required.
	JWTSecret string `env:"JWT_SECRET"`
	// TablePrefix is prepended to every DynamoDB table name.
	TablePrefix string `env:"TABLE_PREFIX" optional:"true" default:"watchtogether-"`
	// WSAPIEndpoint is the https:// endpoint of the API Gateway WebSocket API
	// stage, used by apigatewaymanagementapi PostToConnection. Only the WS
	// Lambda needs it.
	WSAPIEndpoint string `env:"WS_API_ENDPOINT" optional:"true"`
	// AllowedOrigin is the CORS Access-Control-Allow-Origin value for the
	// REST API ("*" is fine for the MVP: auth is bearer-token, not cookies).
	AllowedOrigin string `env:"ALLOWED_ORIGIN" optional:"true" default:"*"`
}

func Load() (*Config, error) {
	ac := kconfig.NewAppConfig[*Config]()
	if err := ac.Load(); err != nil {
		return nil, err
	}
	if err := ac.Validate(); err != nil {
		return nil, err
	}
	return ac.Get(), nil
}
