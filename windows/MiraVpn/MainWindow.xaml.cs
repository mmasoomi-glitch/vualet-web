using System.Windows;
namespace MiraVpn;
public partial class MainWindow : Window
{
    public MainWindow() { InitializeComponent(); }
    protected override void OnStateChanged(EventArgs e) { base.OnStateChanged(e); if (WindowState == WindowState.Minimized) Hide(); }
}
