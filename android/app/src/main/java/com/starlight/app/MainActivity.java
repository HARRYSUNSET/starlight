package com.starlight.app;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (getBridge() == null) {
                    passBackToSystem();
                    return;
                }
                getBridge().getWebView().evaluateJavascript(
                    "Boolean(window.StarlightBack && window.StarlightBack())",
                    handled -> {
                        if (!"true".equals(handled)) passBackToSystem();
                    }
                );
            }

            private void passBackToSystem() {
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
    }
}
