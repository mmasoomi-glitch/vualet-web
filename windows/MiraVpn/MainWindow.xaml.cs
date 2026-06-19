using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;

namespace MiraVpn;

public partial class MainWindow : Window
{
    private readonly TrayIcon _tray;
    private readonly DispatcherTimer _connTimer;
    private DateTime _connStartTime;
    private ConnectionState _state = ConnectionState.Disconnected;

    public ObservableCollection<LogEntry> LogEntries { get; } = new();

    public MainWindow(TrayIcon tray)
    {
        InitializeComponent();
        DataContext = this;
        _tray = tray;
        _tray.Service.StateChanged += OnStateChanged;
        _tray.Service.LogMessage += OnLogMessage;
        _tray.StatsUpdated += OnStatsUpdated;

        _connTimer = new DispatcherTimer(TimeSpan.FromSeconds(1), DispatcherPriority.Normal,
            (_, _) => { ConnTimerText.Text = "Connected: " + (DateTime.Now - _connStartTime).ToString(@"hh\:mm\:ss"); },
            Dispatcher);
        _connTimer.IsEnabled = false;

        var prefs = Prefs.Load();
        AutoConnectCheck.IsChecked = prefs.AutoConnect;
        UpdateUI(ConnectionState.Disconnected, "Disconnected");
    }

    private void OnStateChanged(ConnectionState state, string message)
    { Dispatcher.Invoke(() => UpdateUI(state, message)); }

    private void OnLogMessage(string message)
    { Dispatcher.Invoke(() => AddLogEntry(message)); }

    private void OnStatsUpdated(ulong rx, ulong tx, long handshakeSec)
    {
        Dispatcher.Invoke(() =>
        {
            StatsText.Text = $"Up: {Fmt(tx)}  Down: {Fmt(rx)}";
            long age = _tray.Service.LastHandshakeAge;
            HandshakeText.Text = $"Handshake: {age}s ago";
            if (age > 120)
                HandshakeText.Foreground = (System.Windows.Media.Brush)FindResource("DotErrorBrush");
            else
                HandshakeText.Foreground = new SolidColorBrush(System.Windows.Media.Color.FromRgb(140, 129, 144)); // #8C8190
        });
    }

    private void UpdateUI(ConnectionState state, string message)
    {
        _state = state;
        StateDot.Fill = state switch
        {
            ConnectionState.Disconnected or ConnectionState.Disconnecting => (System.Windows.Media.Brush)FindResource("DotDisconnectedBrush"),
            ConnectionState.Probing or ConnectionState.Connecting => (System.Windows.Media.Brush)FindResource("DotProbingBrush"),
            ConnectionState.Connected => (System.Windows.Media.Brush)FindResource("DotConnectedBrush"),
            ConnectionState.Error => (System.Windows.Media.Brush)FindResource("DotErrorBrush"),
            ConnectionState.Reconnecting => (System.Windows.Media.Brush)FindResource("DotProbingBrush"),
            _ => (System.Windows.Media.Brush)FindResource("DotDisconnectedBrush")
        };
        StateText.Text = message;

        switch (state)
        {
            case ConnectionState.Disconnected:
            case ConnectionState.Error:
                ActionButton.Content = state == ConnectionState.Error ? "Retry" : "Connect";
                ActionButton.IsEnabled = true;
                if (ActionButton.Template.FindName("border", ActionButton) is Border b) b.Background = (System.Windows.Media.Brush)FindResource("BtnGradientBrush");
                _connTimer.IsEnabled = false;
                ConnTimerText.Text = "Connected: —";
                break;
            case ConnectionState.Probing:
            case ConnectionState.Connecting:
                ActionButton.Content = state == ConnectionState.Probing ? "Probing..." : "Connecting...";
                ActionButton.IsEnabled = false;
                break;
            case ConnectionState.Reconnecting:
                ActionButton.Content = "Reconnecting...";
                ActionButton.IsEnabled = false;
                break;
            case ConnectionState.Connected:
                ActionButton.Content = "Disconnect";
                ActionButton.IsEnabled = true;
                if (ActionButton.Template.FindName("border", ActionButton) is Border b2) b2.Background = (System.Windows.Media.Brush)FindResource("BtnConnectedBrush");
                ServerText.Text = $"Server: {_tray.Service.ConnectedServerName} ({_tray.Service.ConnectedEndpoint})";
                LatencyText.Text = $"Latency: {_tray.Service.ConnectedRtt}ms";
                _connStartTime = DateTime.Now;
                _connTimer.IsEnabled = true;
                break;
            case ConnectionState.Disconnecting:
                ActionButton.Content = "Disconnecting...";
                ActionButton.IsEnabled = false;
                _connTimer.IsEnabled = false;
                ConnTimerText.Text = "Connected: —";
                break;
        }

        if (state != ConnectionState.Connected)
        { ServerText.Text = "Server: —"; LatencyText.Text = "Latency: —"; StatsText.Text = "Up: —  Down: —"; HandshakeText.Text = "Handshake: —"; }
    }

    private void AddLogEntry(string message)
    {
        var timestamp = DateTime.Now.ToString("HH:mm:ss");
        string colorKey = "normal";
        if (message.StartsWith("OK")) colorKey = "success";
        else if (message.StartsWith("x")) colorKey = "error";
        LogEntries.Insert(0, new LogEntry(timestamp, message, colorKey));
        while (LogEntries.Count > 10) LogEntries.RemoveAt(LogEntries.Count - 1);
    }

    private void ActionButton_Click(object sender, RoutedEventArgs e)
    {
        switch (_state)
        {
            case ConnectionState.Disconnected:
            case ConnectionState.Error: _tray.Service.Connect(); break;
            case ConnectionState.Connected: _ = _tray.Service.Disconnect(); break;
        }
    }

    private void AutoConnect_Changed(object sender, RoutedEventArgs e)
    {
        var prefs = Prefs.Load();
        prefs.AutoConnect = AutoConnectCheck.IsChecked ?? false;
        prefs.Save();
    }

    protected override void OnClosing(System.ComponentModel.CancelEventArgs e) { e.Cancel = true; Hide(); base.OnClosing(e); }

    private static string Fmt(ulong b) => b < 1024 ? $"{b}B" : b < 1048576 ? $"{b/1024.0:F1}K" : b < 1073741824 ? $"{b/1048576.0:F1}M" : $"{b/1073741824.0:F1}G";
}
