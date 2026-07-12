// REST Lambda: serves the auth + room CRUD API through the Lambda proxy
// adapter, so internal/httpapi's plain http.Handler works unmodified.
package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/aws/aws-lambda-go/lambda"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/awslabs/aws-lambda-go-api-proxy/httpadapter"

	"github.com/MelloB1989/kora/backend/internal/auth"
	"github.com/MelloB1989/kora/backend/internal/config"
	"github.com/MelloB1989/kora/backend/internal/httpapi"
	"github.com/MelloB1989/kora/backend/internal/rooms"
	"github.com/MelloB1989/kora/backend/internal/store"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	slog.SetDefault(log)

	cfg, err := config.Load()
	if err != nil {
		log.Error("config", "err", err)
		os.Exit(1)
	}
	awsCfg, err := awsconfig.LoadDefaultConfig(context.Background())
	if err != nil {
		log.Error("aws config", "err", err)
		os.Exit(1)
	}

	st := store.NewDynamo(dynamodb.NewFromConfig(awsCfg), cfg.TablePrefix)
	api := httpapi.New(st, auth.NewManager(cfg.JWTSecret, 0), rooms.NewService(st))

	lambda.Start(httpadapter.NewV2(api.Router(cfg.AllowedOrigin)).ProxyWithContext)
}
