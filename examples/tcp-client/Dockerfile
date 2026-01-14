FROM golang:1.22-alpine AS builder

WORKDIR /app
COPY go.mod ./
COPY main.go ./

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o tcp-client

FROM alpine:3.19
WORKDIR /app
COPY --from=builder /app/tcp-client /usr/local/bin/tcp-client

EXPOSE 5002
ENTRYPOINT ["/usr/local/bin/tcp-client"]
