// WebSocket Lambda: handles API Gateway WebSocket $connect/$disconnect/$default
// events and delegates to the transport-agnostic relay handler.
package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"

	"github.com/MelloB1989/kora/backend/internal/auth"
	"github.com/MelloB1989/kora/backend/internal/config"
	"github.com/MelloB1989/kora/backend/internal/relay"
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
	sender := relay.NewAPIGatewaySender(awsCfg, cfg.WSAPIEndpoint)
	handler := relay.NewHandler(st, rooms.NewService(st), auth.NewManager(cfg.JWTSecret, 0), sender, log)

	lambda.Start(func(ctx context.Context, req events.APIGatewayWebsocketProxyRequest) (events.APIGatewayProxyResponse, error) {
		connID := req.RequestContext.ConnectionID
		switch req.RequestContext.RouteKey {
		case "$connect":
			if err := handler.HandleConnect(ctx, connID, req.QueryStringParameters["token"]); err != nil {
				log.Info("connect rejected", "err", err)
				return events.APIGatewayProxyResponse{StatusCode: 401, Body: "unauthorized"}, nil
			}
		case "$disconnect":
			if err := handler.HandleDisconnect(ctx, connID); err != nil {
				log.Error("disconnect", "err", err, "connectionId", connID)
			}
		default: // $default — all application messages
			if err := handler.HandleMessage(ctx, connID, []byte(req.Body)); err != nil {
				log.Error("message", "err", err, "connectionId", connID)
				return events.APIGatewayProxyResponse{StatusCode: 500, Body: "error"}, nil
			}
		}
		return events.APIGatewayProxyResponse{StatusCode: 200, Body: "ok"}, nil
	})
}
