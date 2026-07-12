package relay

import (
	"context"
	"errors"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/apigatewaymanagementapi"
	"github.com/aws/aws-sdk-go-v2/service/apigatewaymanagementapi/types"
)

// APIGatewaySender delivers frames via the API Gateway Management API
// (PostToConnection). endpoint is the https:// URL of the WebSocket stage,
// e.g. https://abc123.execute-api.us-east-1.amazonaws.com/prod.
type APIGatewaySender struct {
	client *apigatewaymanagementapi.Client
}

var _ Sender = (*APIGatewaySender)(nil)

func NewAPIGatewaySender(cfg aws.Config, endpoint string) *APIGatewaySender {
	client := apigatewaymanagementapi.NewFromConfig(cfg, func(o *apigatewaymanagementapi.Options) {
		o.BaseEndpoint = aws.String(endpoint)
	})
	return &APIGatewaySender{client: client}
}

func (s *APIGatewaySender) Send(ctx context.Context, connectionID string, data []byte) error {
	_, err := s.client.PostToConnection(ctx, &apigatewaymanagementapi.PostToConnectionInput{
		ConnectionId: aws.String(connectionID),
		Data:         data,
	})
	var gone *types.GoneException
	if errors.As(err, &gone) {
		return ErrGone
	}
	return err
}
