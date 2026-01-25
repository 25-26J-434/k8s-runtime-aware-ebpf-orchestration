FROM golang:1.22-alpine AS builder

WORKDIR /app
COPY go.mod ./
COPY main.go ./

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o service-a

FROM alpine:3.19
WORKDIR /app
COPY --from=builder /app/service-a /usr/local/bin/service-a

EXPOSE 5000
ENTRYPOINT ["/usr/local/bin/service-a"]
