
import EventEmitter from './EventEmitter.js';

class PlayFabManager extends EventEmitter {
    constructor() {
        super();
        this.titleId = "123FF2"; 
        if (this.titleId === "123FF2") {
            console.warn("PlayFab Title ID is not set. Please replace '123FF2' in PlayFabManager.js with your actual Title ID.");
        }
        PlayFab.settings.titleId = this.titleId;
    }

    _callPlayFabApi(apiCall, request, callback) {
        const promise = apiCall(request, callback);
        // The PlayFab SDK incorrectly throws uncaught promise rejections on 400 errors,
        // even though it provides an error object to the callback. This empty catch
        // block is to prevent those console errors. The error is handled in the callback.
        if (promise && typeof promise.catch === 'function') {
            promise.catch(() => {});
        }
    }

    login(email, password) {
        const loginRequest = {
            Email: email,
            Password: password,
            TitleId: this.titleId,
            InfoRequestParameters: {
                GetUserAccountInfo: true
            }
        };

        this._callPlayFabApi(PlayFabClientSDK.LoginWithEmailAddress, loginRequest, (result, error) => {
            if (result) {
                this.emit('loginSuccess', result.data);
            } else {
                this.emit('loginFailure', this.handleError(error));
            }
        });
    }

    register(email, password) {
        const randomSuffix = Math.random().toString(36).substring(2, 7);
        const registerRequest = {
            Email: email,
            Password: password,
            Username: email.split('@')[0] + randomSuffix, // Add random chars to avoid conflict
            TitleId: this.titleId,
            DisplayName: email.split('@')[0] + randomSuffix
        };

        this._callPlayFabApi(PlayFabClientSDK.RegisterPlayFabUser, registerRequest, (result, error) => {
            if (result) {
                this.emit('registerSuccess', result.data);
            } else {
                this.emit('registerFailure', this.handleError(error));
            }
        });
    }

    forgotPassword(email) {
        const request = {
            Email: email,
            TitleId: this.titleId
        };
        this._callPlayFabApi(PlayFabClientSDK.SendAccountRecoveryEmail, request, (result, error) => {
            if (result) {
                this.emit('forgotPasswordSuccess', 'Password recovery email sent. Please check your inbox.');
            } else {
                this.emit('forgotPasswordFailure', this.handleError(error));
            }
        });
    }

    handleError(error) {
        let errorMessage = "An unknown error occurred.";
        if (error) {
            if (error.errorMessage) {
                // Handle specific, common errors with more user-friendly messages
                if (error.error === 'EmailAddressNotAvailable') {
                    errorMessage = 'This email address is already in use.';
                } else if (error.error === 'NameNotAvailable') {
                    errorMessage = 'That display name is already taken. Please choose another.';
                } else if (error.error === 'InvalidParams' && error.errorDetails && error.errorDetails.Password) {
                    errorMessage = 'Password must be between 6 and 100 characters.';
                }
                else {
                    errorMessage = error.errorMessage;
                }
            } else if (error.errorDetails) {
                const details = Object.values(error.errorDetails).flat();
                if (details.length > 0) {
                    errorMessage = details.join(' ');
                }
            }
        }
        console.error("PlayFab Error:", error);
        return errorMessage;
    }
}

export const playFabManager = new PlayFabManager();
