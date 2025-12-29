FROM golang:1.21-alpine AS builder

WORKDIR /app

# Copy go mod file
COPY go.mod ./
RUN go mod download || true

# Copy source
COPY main.go ./

# Build
RUN CGO_ENABLED=0 GOOS=linux go build -o cpu-stress main.go

# Final stage
FROM alpine:latest

RUN apk --no-cache add ca-certificates

WORKDIR /root/

COPY --from=builder /app/cpu-stress .

EXPOSE 8080

CMD ["./cpu-stress"]

