package com.starlight.app;

import android.os.Build;
import android.provider.Settings;
import android.view.HapticFeedbackConstants;
import android.view.View;
import androidx.annotation.NonNull;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsAnimationCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Observes keyboard motion without taking ownership of Capacitor's inset/padding layout. */
@CapacitorPlugin(name = "StarlightMotion")
public class MotionPlugin extends Plugin {
    private View observedView;
    private WindowInsetsCompat lastInsets;
    private final Set<WindowInsetsAnimationCompat> imeAnimations = new HashSet<>();
    private boolean scheduled;
    private boolean destroyed;
    private boolean paused;
    private float progress = 1f;
    private float animationScale = 1f;
    private int sequence;
    private String lastSignature = "";

    private final Runnable publishFrame = () -> {
        scheduled = false;
        if (destroyed || paused || observedView == null) return;
        JSObject state = currentState();
        String signature = state.toString();
        if (signature.equals(lastSignature)) return;
        lastSignature = signature;
        state.put("sequence", ++sequence);
        notifyListeners("viewport", state);
    };

    private final View.OnLayoutChangeListener layoutListener = (view, left, top, right, bottom,
            oldLeft, oldTop, oldRight, oldBottom) -> {
        // Root insets can already represent the END frame while an animation is in flight.
        if (imeAnimations.isEmpty()) lastInsets = ViewCompat.getRootWindowInsets(view);
        scheduleFrame();
    };

    @Override
    public void load() {
        getActivity().runOnUiThread(() -> {
            if (destroyed) return;
            observedView = getBridge().getWebView();
            refreshAnimationScale();
            lastInsets = ViewCompat.getRootWindowInsets(observedView);
            observedView.addOnLayoutChangeListener(layoutListener);
            // Do not replace SystemBars' OnApplyWindowInsetsListener on the parent view.
            ViewCompat.setWindowInsetsAnimationCallback(observedView,
                new WindowInsetsAnimationCompat.Callback(
                    WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
                    @Override
                    public void onPrepare(@NonNull WindowInsetsAnimationCompat animation) {
                        if ((animation.getTypeMask() & WindowInsetsCompat.Type.ime()) == 0) return;
                        imeAnimations.add(animation);
                        progress = 0f;
                        scheduleFrame();
                    }

                    @NonNull
                    @Override
                    public WindowInsetsCompat onProgress(@NonNull WindowInsetsCompat insets,
                            @NonNull List<WindowInsetsAnimationCompat> animations) {
                        for (WindowInsetsAnimationCompat animation : animations) {
                            if ((animation.getTypeMask() & WindowInsetsCompat.Type.ime()) != 0) {
                                imeAnimations.add(animation);
                                progress = animation.getInterpolatedFraction();
                                lastInsets = insets;
                                scheduleFrame();
                            }
                        }
                        return insets;
                    }

                    @Override
                    public void onEnd(@NonNull WindowInsetsAnimationCompat animation) {
                        if (!imeAnimations.remove(animation)) return;
                        if (imeAnimations.isEmpty()) {
                            progress = 1f;
                            lastInsets = ViewCompat.getRootWindowInsets(observedView);
                        }
                        scheduleFrame();
                    }
                });
            scheduleFrame();
        });
    }

    private void refreshAnimationScale() {
        try {
            animationScale = Math.max(0f, Settings.Global.getFloat(
                getContext().getContentResolver(), Settings.Global.ANIMATOR_DURATION_SCALE, 1f));
        } catch (RuntimeException ignored) { animationScale = 1f; }
    }

    private void scheduleFrame() {
        if (scheduled || destroyed || paused || observedView == null) return;
        scheduled = true;
        observedView.postOnAnimation(publishFrame);
    }

    private JSObject currentState() {
        float density = Math.max(1f, getContext().getResources().getDisplayMetrics().density);
        JSObject result = new JSObject();
        result.put("available", true);
        result.put("sdk", Build.VERSION.SDK_INT);
        result.put("nativeAnimation", Build.VERSION.SDK_INT >= 30);
        result.put("insetsKnown", lastInsets != null);
        result.put("keyboardVisible", lastInsets != null && lastInsets.isVisible(WindowInsetsCompat.Type.ime()));
        result.put("insetBottom", lastInsets == null ? 0 : lastInsets.getInsets(WindowInsetsCompat.Type.ime()).bottom / density);
        result.put("animating", !imeAnimations.isEmpty());
        result.put("progress", Math.min(1f, Math.max(0f, progress)));
        result.put("animationScale", animationScale);
        // Insets are metadata. adjustResize + VisualViewport remain the ONLY layout owner.
        result.put("layoutOwner", "webview");
        return result;
    }

    @PluginMethod
    public void getState(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (destroyed) { call.reject("Motion bridge disposed"); return; }
            refreshAnimationScale();
            if (imeAnimations.isEmpty() && observedView != null) lastInsets = ViewCompat.getRootWindowInsets(observedView);
            JSObject result = currentState();
            result.put("sequence", ++sequence);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void feedback(PluginCall call) {
        String kind = call.getString("kind", "selection");
        getActivity().runOnUiThread(() -> {
            boolean performed = false;
            if (!destroyed && !paused && observedView != null && observedView.isAttachedToWindow()) {
                // No ignore-setting flags or vibration permission: respect the system preference.
                int feedback = "longPress".equals(kind)
                    ? HapticFeedbackConstants.LONG_PRESS : HapticFeedbackConstants.CONTEXT_CLICK;
                performed = observedView.performHapticFeedback(feedback);
            }
            JSObject result = new JSObject();
            result.put("performed", performed);
            call.resolve(result);
        });
    }

    @Override
    protected void handleOnPause() {
        paused = true;
        if (observedView != null) observedView.removeCallbacks(publishFrame);
        scheduled = false;
        imeAnimations.clear();
        progress = 1f;
    }

    @Override
    protected void handleOnResume() {
        paused = false;
        refreshAnimationScale();
        if (observedView != null) lastInsets = ViewCompat.getRootWindowInsets(observedView);
        lastSignature = "";
        scheduleFrame();
    }

    @Override
    protected void handleOnDestroy() {
        destroyed = true;
        if (observedView != null) {
            observedView.removeCallbacks(publishFrame);
            observedView.removeOnLayoutChangeListener(layoutListener);
            ViewCompat.setWindowInsetsAnimationCallback(observedView, null);
        }
        imeAnimations.clear();
        observedView = null;
    }
}
