package store

import (
	"context"
	"errors"
	"fmt"
	"strconv"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/MelloB1989/kora/backend/internal/models"
)

// Dynamo implements Store on DynamoDB. Table names are prefix + entity name;
// key schemas and GSIs are defined in backend/template.yaml.
type Dynamo struct {
	db     *dynamodb.Client
	prefix string
}

var _ Store = (*Dynamo)(nil)

func NewDynamo(db *dynamodb.Client, tablePrefix string) *Dynamo {
	return &Dynamo{db: db, prefix: tablePrefix}
}

func (d *Dynamo) table(name string) *string { return aws.String(d.prefix + name) }

const (
	tableUsers       = "users"
	tableRooms       = "rooms"
	tableMembers     = "room-members"
	tableConnections = "connections"
	tableEvents      = "playback-events"
	tableSessions    = "watch-sessions"
	tableProgress    = "show-progress"

	indexEmail = "email-index"
	indexRoom  = "room-index"
)

func (d *Dynamo) putItem(ctx context.Context, table string, item any, condition *string) error {
	av, err := attributevalue.MarshalMap(item)
	if err != nil {
		return fmt.Errorf("marshal %s item: %w", table, err)
	}
	_, err = d.db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName:           d.table(table),
		Item:                av,
		ConditionExpression: condition,
	})
	var cfe *types.ConditionalCheckFailedException
	if errors.As(err, &cfe) {
		return ErrAlreadyExists
	}
	return err
}

func (d *Dynamo) getItem(ctx context.Context, table string, key map[string]types.AttributeValue, out any) error {
	res, err := d.db.GetItem(ctx, &dynamodb.GetItemInput{TableName: d.table(table), Key: key})
	if err != nil {
		return err
	}
	if len(res.Item) == 0 {
		return ErrNotFound
	}
	return attributevalue.UnmarshalMap(res.Item, out)
}

func skey(k, v string) map[string]types.AttributeValue {
	return map[string]types.AttributeValue{k: &types.AttributeValueMemberS{Value: v}}
}

// --- Users ---

func (d *Dynamo) PutUser(ctx context.Context, u *models.User) error {
	return d.putItem(ctx, tableUsers, u, aws.String("attribute_not_exists(userId)"))
}

func (d *Dynamo) GetUser(ctx context.Context, userID string) (*models.User, error) {
	var u models.User
	if err := d.getItem(ctx, tableUsers, skey("userId", userID), &u); err != nil {
		return nil, err
	}
	return &u, nil
}

func (d *Dynamo) GetUserByEmail(ctx context.Context, email string) (*models.User, error) {
	res, err := d.db.Query(ctx, &dynamodb.QueryInput{
		TableName:              d.table(tableUsers),
		IndexName:              aws.String(indexEmail),
		KeyConditionExpression: aws.String("email = :e"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":e": &types.AttributeValueMemberS{Value: email},
		},
		Limit: aws.Int32(1),
	})
	if err != nil {
		return nil, err
	}
	if len(res.Items) == 0 {
		return nil, ErrNotFound
	}
	var u models.User
	if err := attributevalue.UnmarshalMap(res.Items[0], &u); err != nil {
		return nil, err
	}
	return &u, nil
}

// --- Rooms ---

func (d *Dynamo) PutRoom(ctx context.Context, r *models.Room) error {
	return d.putItem(ctx, tableRooms, r, nil)
}

func (d *Dynamo) GetRoom(ctx context.Context, roomID string) (*models.Room, error) {
	var r models.Room
	if err := d.getItem(ctx, tableRooms, skey("roomId", roomID), &r); err != nil {
		return nil, err
	}
	return &r, nil
}

func (d *Dynamo) updateRoomAttr(ctx context.Context, roomID, attr, value string) error {
	_, err := d.db.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:           d.table(tableRooms),
		Key:                 skey("roomId", roomID),
		UpdateExpression:    aws.String("SET #a = :v"),
		ConditionExpression: aws.String("attribute_exists(roomId)"),
		ExpressionAttributeNames: map[string]string{
			"#a": attr,
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":v": &types.AttributeValueMemberS{Value: value},
		},
	})
	var cfe *types.ConditionalCheckFailedException
	if errors.As(err, &cfe) {
		return ErrNotFound
	}
	return err
}

func (d *Dynamo) UpdateRoomStatus(ctx context.Context, roomID, status string) error {
	return d.updateRoomAttr(ctx, roomID, "status", status)
}

func (d *Dynamo) UpdateRoomHost(ctx context.Context, roomID, hostUserID string) error {
	return d.updateRoomAttr(ctx, roomID, "hostUserId", hostUserID)
}

func (d *Dynamo) UpdateRoomProgress(ctx context.Context, roomID string, position, duration float64) error {
	names := map[string]string{"#p": "lastPosition"}
	values := map[string]types.AttributeValue{
		":p": &types.AttributeValueMemberN{Value: strconv.FormatFloat(position, 'f', -1, 64)},
	}
	expr := "SET #p = :p"
	if duration > 0 {
		names["#d"] = "duration"
		values[":d"] = &types.AttributeValueMemberN{Value: strconv.FormatFloat(duration, 'f', -1, 64)}
		expr += ", #d = :d"
	}
	_, err := d.db.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:                 d.table(tableRooms),
		Key:                       skey("roomId", roomID),
		UpdateExpression:          aws.String(expr),
		ConditionExpression:       aws.String("attribute_exists(roomId)"),
		ExpressionAttributeNames:  names,
		ExpressionAttributeValues: values,
	})
	var cfe *types.ConditionalCheckFailedException
	if errors.As(err, &cfe) {
		return ErrNotFound
	}
	return err
}

// --- Room members ---

func (d *Dynamo) PutMember(ctx context.Context, m *models.RoomMember) error {
	return d.putItem(ctx, tableMembers, m, nil)
}

func (d *Dynamo) GetMember(ctx context.Context, roomID, userID string) (*models.RoomMember, error) {
	var m models.RoomMember
	key := map[string]types.AttributeValue{
		"roomId": &types.AttributeValueMemberS{Value: roomID},
		"userId": &types.AttributeValueMemberS{Value: userID},
	}
	if err := d.getItem(ctx, tableMembers, key, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

func (d *Dynamo) DeleteMember(ctx context.Context, roomID, userID string) error {
	_, err := d.db.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: d.table(tableMembers),
		Key: map[string]types.AttributeValue{
			"roomId": &types.AttributeValueMemberS{Value: roomID},
			"userId": &types.AttributeValueMemberS{Value: userID},
		},
	})
	return err
}

func (d *Dynamo) ListMembers(ctx context.Context, roomID string) ([]models.RoomMember, error) {
	res, err := d.db.Query(ctx, &dynamodb.QueryInput{
		TableName:              d.table(tableMembers),
		KeyConditionExpression: aws.String("roomId = :r"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":r": &types.AttributeValueMemberS{Value: roomID},
		},
	})
	if err != nil {
		return nil, err
	}
	var out []models.RoomMember
	if err := attributevalue.UnmarshalListOfMaps(res.Items, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// --- Connections ---

func (d *Dynamo) PutConnection(ctx context.Context, c *models.Connection) error {
	return d.putItem(ctx, tableConnections, c, nil)
}

func (d *Dynamo) GetConnection(ctx context.Context, connectionID string) (*models.Connection, error) {
	var c models.Connection
	if err := d.getItem(ctx, tableConnections, skey("connectionId", connectionID), &c); err != nil {
		return nil, err
	}
	return &c, nil
}

func (d *Dynamo) DeleteConnection(ctx context.Context, connectionID string) error {
	_, err := d.db.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: d.table(tableConnections),
		Key:       skey("connectionId", connectionID),
	})
	return err
}

func (d *Dynamo) SetConnectionRoom(ctx context.Context, connectionID, roomID string) error {
	_, err := d.db.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:           d.table(tableConnections),
		Key:                 skey("connectionId", connectionID),
		UpdateExpression:    aws.String("SET roomId = :r"),
		ConditionExpression: aws.String("attribute_exists(connectionId)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":r": &types.AttributeValueMemberS{Value: roomID},
		},
	})
	var cfe *types.ConditionalCheckFailedException
	if errors.As(err, &cfe) {
		return ErrNotFound
	}
	return err
}

func (d *Dynamo) ListRoomConnections(ctx context.Context, roomID string) ([]models.Connection, error) {
	res, err := d.db.Query(ctx, &dynamodb.QueryInput{
		TableName:              d.table(tableConnections),
		IndexName:              aws.String(indexRoom),
		KeyConditionExpression: aws.String("roomId = :r"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":r": &types.AttributeValueMemberS{Value: roomID},
		},
	})
	if err != nil {
		return nil, err
	}
	var out []models.Connection
	if err := attributevalue.UnmarshalListOfMaps(res.Items, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// --- Playback events ---

func (d *Dynamo) PutPlaybackEvent(ctx context.Context, e *models.PlaybackEvent) error {
	return d.putItem(ctx, tableEvents, e, nil)
}

func (d *Dynamo) LatestPlaybackEvent(ctx context.Context, roomID string) (*models.PlaybackEvent, error) {
	res, err := d.db.Query(ctx, &dynamodb.QueryInput{
		TableName:              d.table(tableEvents),
		KeyConditionExpression: aws.String("roomId = :r"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":r": &types.AttributeValueMemberS{Value: roomID},
		},
		ScanIndexForward: aws.Bool(false),
		Limit:            aws.Int32(1),
	})
	if err != nil {
		return nil, err
	}
	if len(res.Items) == 0 {
		return nil, ErrNotFound
	}
	var e models.PlaybackEvent
	if err := attributevalue.UnmarshalMap(res.Items[0], &e); err != nil {
		return nil, err
	}
	return &e, nil
}

// --- Watch sessions / show progress ---

func (d *Dynamo) PutWatchSession(ctx context.Context, s *models.WatchSession) error {
	return d.putItem(ctx, tableSessions, s, nil)
}

func (d *Dynamo) ListWatchSessions(ctx context.Context, userID string) ([]models.WatchSession, error) {
	res, err := d.db.Query(ctx, &dynamodb.QueryInput{
		TableName:              d.table(tableSessions),
		KeyConditionExpression: aws.String("userId = :u"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":u": &types.AttributeValueMemberS{Value: userID},
		},
		ScanIndexForward: aws.Bool(false), // newest first
		Limit:            aws.Int32(200),
	})
	if err != nil {
		return nil, err
	}
	var out []models.WatchSession
	if err := attributevalue.UnmarshalListOfMaps(res.Items, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (d *Dynamo) UpsertShowProgress(ctx context.Context, p *models.ShowProgress) error {
	return d.putItem(ctx, tableProgress, p, nil)
}

func (d *Dynamo) ListShowProgress(ctx context.Context, userID string) ([]models.ShowProgress, error) {
	res, err := d.db.Query(ctx, &dynamodb.QueryInput{
		TableName:              d.table(tableProgress),
		KeyConditionExpression: aws.String("userId = :u"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":u": &types.AttributeValueMemberS{Value: userID},
		},
	})
	if err != nil {
		return nil, err
	}
	var out []models.ShowProgress
	if err := attributevalue.UnmarshalListOfMaps(res.Items, &out); err != nil {
		return nil, err
	}
	return out, nil
}
