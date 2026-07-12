# WatchTogether backend
#
# Local development uses the in-memory store (no AWS needed):
#   make localdev
#
# SAM packages each function via the `build-<LogicalId>` targets below
# (referenced by `Metadata: BuildMethod: makefile` in template.yaml).

.PHONY: test fmt localdev build deploy

test:
	go test ./...

fmt:
	gofmt -w .

localdev:
	JWT_SECRET=$${JWT_SECRET:-localdev-secret} go run ./cmd/localdev

# --- SAM build hooks (invoked as `sam build`) ---
build-RestFunction:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -tags lambda.norpc -o $(ARTIFACTS_DIR)/rest ./cmd/rest

build-WsFunction:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -tags lambda.norpc -o $(ARTIFACTS_DIR)/ws ./cmd/ws

build:
	sam build

# Deploy requires AWS credentials. Pass a real JWT secret:
#   make deploy JWT_SECRET=$(openssl rand -hex 32)
deploy: build
	sam deploy --guided --parameter-overrides JwtSecret=$${JWT_SECRET:?set JWT_SECRET}
