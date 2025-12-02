package plugins

type Plugin interface {
    Name() string
    Init() error
}
