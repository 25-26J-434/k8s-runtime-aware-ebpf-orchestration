FROM golang:1.22-alpine AS builder

WORKDIR /app
COPY go.mod ./
COPY main.go ./

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o service-c

FROM alpine:3.19
WORKDIR /app
COPY --from=builder /app/service-c /usr/local/bin/service-c

EXPOSE 5003
ENTRYPOINT ["/usr/local/bin/service-c"]
