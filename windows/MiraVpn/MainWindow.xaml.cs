using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace MiraVpn;

public partial class MainWindow : Window
{
    private readonly TrayIcon _tray;
    private ConnectionState _state = ConnectionState.Disconnected;
    private static System.Windows.Media.Brush _logNormal = new SolidColorBrush(System.Windows.Media.Color.FromRgb(0xC7, 0xB8, 0xF0));
    private static System.Windows.Media.Brush _logSuccess = new SolidColorBrush(System.Windows.Media.Color.FromRgb(0xA5, 0xE8, 0xA5));
    private static System.Windows.Media.Brush _logError = new SolidColorBrush(System.Windows.Media.Color.FromRgb(0xF8, 0xA5, 0xA0));
    private static System.Windows.Media.Brush _dotDisconnected = new SolidColorBrush(System.Windows.Media.Color.FromRgb(0x8C, 0x81, 0x90));
    private static System.Windows.Media.Brush _dotProbing = new SolidColorBrush(System.Windows.Media.Color.FromRgb(0xF8, 0xC5, 0x4A));
    private static System.Windows.Media.Brush _dotConnected = new SolidColorBrush(System.Windows.Media.Color.FromRgb(0x4E, 0xC9, 0xB0));
    private static System.Windows.Media.Brush _dotError = new SolidColorBrush(System.Windows.Media.Color.FromRgb(0xE6, 0x8A, 0x85));
    private static System.Windows.Media.Brush _btnGradient = new SolidColorBrush(System.Windows.Media.Color.FromRgb(0xF8, 0xA5, 0xA0));
    private static System.Windows.Media.Brush _btnConnected = new SolidColorBrush(System.Windows.Media.Color.FromRgb(0x1A, 0x15, 0x25));

    public MainWindow(TrayIcon tray)
    {
        InitializeComponent();
        _tray = tray;
        _tray.StateChanged += OnStateChanged;
        _tray.LogMessage += OnLogMessage;
        _tray.StatsUpdated += OnStatsUpdated;
        var prefs = Prefs.Load();
        AutoConnectCheck.IsChecked = prefs.AutoConnect;
        UpdateUI(ConnectionState.Disconnected, "Disconnected");
    }

    private void OnStateChanged(ConnectionState state, string message)
    { Dispatcher.Invoke(() => UpdateUI(state, message)); }

    private void OnLogMessage(string message)
    { Dispatcher.Invoke(() => AddLogEntry(message)); }

    private void OnStatsUpdated(ulong rx, ulong tx)
    { Dispatcher.Invoke(() => { StatsText.Text = $"Up: {Fmt(tx)}  Down: {Fmt(rx)}"; }); }

    private void UpdateUI(ConnectionState state, string message)
    {
        _state = state;
        StateDot.Fill = state switch
        {
            ConnectionState.Disconnected or ConnectionState.Disconnecting => _dotDisconnected,
            ConnectionState.Probing or ConnectionState.Connecting => _dotProbing,
            ConnectionState.Connected => _dotConnected,
            ConnectionState.Error => _dotError,
            _ => _dotDisconnected
        };
        StateText.Text = message;

        switch (state)
        {
            case ConnectionState.Disconnected:
            case ConnectionState.Error:
                ActionButton.Content = state == ConnectionState.Error ? "Retry" : "Connect";
                ActionButton.IsEnabled = true;
                if (ActionButton.Template.FindName("border", ActionButton) is Border b) b.Background = _btnGradient;
                break;
            case ConnectionState.Probing:
            case ConnectionState.Connecting:
                ActionButton.Content = state == ConnectionState.Probing ? "Probing..." : "Connecting...";
                ActionButton.IsEnabled = false;
                break;
            case ConnectionState.Connected:
                ActionButton.Content = "Disconnect";
                ActionButton.IsEnabled = true;
                if (ActionButton.Template.FindName("border", ActionButton) is Border b2) b2.Background = _btnConnected;
                ServerText.Text = $"Server: {_tray.ConnectedEndpoint}";
                LatencyText.Text = $"Latency: {_tray.ConnectedRtt}ms";
                break;
            case ConnectionState.Disconnecting:
                ActionButton.Content = "Disconnecting...";
                ActionButton.IsEnabled = false;
                break;
        }

        if (state != ConnectionState.Connected)
        { ServerText.Text = "Server: —"; LatencyText.Text = "Latency: —"; StatsText.Text = "Up: —  Down: —"; }
    }

    private void AddLogEntry(string message)
    {
        var timestamp = DateTime.Now.ToString("HH:mm:ss");
        System.Windows.Media.Brush color = _logNormal;
        if (message.StartsWith("OK")) color = _logSuccess;
        else if (message.StartsWith("x")) color = _logError;
        var entry = new TextBlock
        {
            Text = $"{timestamp}  {message}",
            FontFamily = new System.Windows.Media.FontFamily("Consolas, Courier New"),
            FontSize = 11, Foreground = color, Margin = new Thickness(0, 2, 0, 2),
            TextWrapping = TextWrapping.Wrap
        };
        LogPanel.Children.Insert(0, entry);
        while (LogPanel.Children.Count > 10) LogPanel.Children.RemoveAt(LogPanel.Children.Count - 1);
    }

    private void ActionButton_Click(object sender, RoutedEventArgs e)
    {
        switch (_state)
        {
            case ConnectionState.Disconnected:
            case ConnectionState.Error: _tray.Connect(); break;
            case ConnectionState.Connected: _ = _tray.Disconnect(); break;
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
