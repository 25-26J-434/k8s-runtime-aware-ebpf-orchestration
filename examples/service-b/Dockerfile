FROM golang:1.22-alpine AS builder

WORKDIR /app
COPY go.mod ./
COPY main.go ./

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o service-b

FROM alpine:3.19
WORKDIR /app
COPY --from=builder /app/service-b /usr/local/bin/service-b

EXPOSE 5001
ENTRYPOINT ["/usr/local/bin/service-b"]
