package com.starlight.app;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(ArchivePlugin.class);
        registerPlugin(MotionPlugin.class);
        super.onCreate(savedInstanceState);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            private boolean awaitingWebBack = false;

            @Override
            public void handleOnBackPressed() {
                // One system press must not race several asynchronous WebView navigations.
                if (awaitingWebBack) return;
                if (getBridge() == null) {
                    passBackToSystem();
                    return;
                }
                awaitingWebBack = true;
                try {
                    getBridge().getWebView().evaluateJavascript(
                        "Boolean(window.StarlightBack && window.StarlightBack())",
                        handled -> {
                            awaitingWebBack = false;
                            if (!isFinishing() && !isDestroyed() && !"true".equals(handled)) passBackToSystem();
                        }
                    );
                } catch (RuntimeException error) {
                    awaitingWebBack = false;
                    if (!isFinishing() && !isDestroyed()) passBackToSystem();
                }
            }

            private void passBackToSystem() {
                setEnabled(false);
                try { getOnBackPressedDispatcher().onBackPressed(); }
                finally { setEnabled(true); }
            }
        });
    }
}
