declare let kintone: any;
declare let process: any;

type KintoneEvent = {
  record: KintoneRecord;
};

type KintoneRecord = {
  $id: {
    value: string;
  };
  clientId: {
    value: string;
  };
  clientSecret: {
    value: string;
  };
  accessToken: {
    value: string;
  };
  refreshToken: {
    value: string;
  };
  expiresDateTime: {
    value: string;
  };
  state: {
    value: string;
  };
};

type RawCredentials = {
  created_at: number;
  expires_in: number;
  access_token: string;
  refresh_token: string;
};

(function () {
  // UUIDを生成する
  function generateUuid() {
    // https://github.com/GoogleChrome/chrome-platform-analytics/blob/master/src/internal/identifier.js
    // const FORMAT: string = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
    const chars = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".split("");
    for (let i = 0, len = chars.length; i < len; i++) {
      switch (chars[i]) {
        case "x":
          chars[i] = Math.floor(Math.random() * 16).toString(16);
          break;
        case "y":
          chars[i] = (Math.floor(Math.random() * 4) + 8).toString(16);
          break;
      }
    }
    return chars.join("");
  }

  async function saveCredentials(
    record: KintoneRecord,
    credentials: RawCredentials
  ) {
    // 有効期限を日付に変換
    const expiredDateTime = new Date(
      credentials.created_at * 1000 + credentials.expires_in * 1000
    );

    const putParams = {
      app: kintone.app.getId(),
      id: record.$id.value,
      record: {
        accessToken: {
          value: credentials.access_token,
        },
        refreshToken: {
          value: credentials.refresh_token,
        },
        expiresDateTime: {
          value: expiredDateTime.toISOString(),
        },
      },
    };

    await kintone.api("/k/v1/record", "PUT", putParams);
  }
  // 保存済みのfreee認証がない場合、レコードの新規作成に移動する
  kintone.events.on(["app.record.index.show"], async (event: KintoneEvent) => {
    const params = {
      app: kintone.app.getId(),
      query: "作成者 in (LOGINUSER())",
    };
    const resp = await kintone.api("/k/v1/records", "GET", params);
    if (resp.records.length !== 1) {
      location.href = location.pathname + "edit";
    }
    return event;
  });

  // 新規作成画面のリンクからOAuth画面を開く
  kintone.events.on(["app.record.create.show"], (event: KintoneEvent) => {
    const header = kintone.app.record.getHeaderMenuSpaceElement();
    console.log(header);
    header.innerHTML =
      '<div style="padding: 15px 30px">' +
      '<a href="https://app.secure.freee.co.jp/developers/applications" target="_blank">freee連携アプリ設定を開く</a>' +
      "</div>";
  });
  kintone.events.on(
    ["app.record.create.submit", "app.record.edit.submit"],
    function (event: KintoneEvent) {
      // UUIDをstateに一時保存する
      event.record.state.value = generateUuid();
      return event;
    }
  );
  // 初回認証を実施するためのコードを追加
  kintone.events.on(
    ["app.record.create.submit.success", "app.record.edit.submit.success"],
    function (event: KintoneEvent) {
      location.href =
        "https://accounts.secure.freee.co.jp/public_api/authorize?" +
        "client_id=" +
        event.record.clientId.value +
        "&redirect_uri=" +
        encodeURIComponent(
          "https://" + location.host + "/k/" + kintone.app.getId() + "/"
        ) +
        "&response_type=code" +
        `&state=${event.record.state.value}`;
      return event;
    }
  );

  // コールバックURLに対応するJavaScriptを作成
  kintone.events.on("app.record.index.show", async (event: KintoneEvent) => {
    const params = {
      app: kintone.app.getId(),
      query: "作成者 in (LOGINUSER())",
    };
    const resp = await kintone.api("/k/v1/records", "GET", params);
    if (resp.records.length !== 1) return;

    const record: KintoneRecord = resp.records[0];

    const queryString = location.search;
    const queryParams = new URLSearchParams(queryString);
    const code = queryParams.get("code");

    // 有効期限判定
    let valid = false;
    if (record.expiresDateTime.value) {
      const expiresDateTime = new Date(record.expiresDateTime.value);
      if (new Date() < expiresDateTime && record.accessToken.value) {
        valid = true;
      }
    }

    // 有効期限切れの場合
    if (!valid && record.refreshToken.value) {
      console.log("Try to refresh access token...");
      const header = {
        "Content-Type": "application/x-www-form-urlencoded",
      };
      const body =
        "grant_type=refresh_token" +
        `&client_id=${record.clientId.value}` +
        `&client_secret=${record.clientSecret.value}` +
        `&redirect_uri=${encodeURIComponent(
          `https://${location.host}/k/${kintone.app.getId()}/`
        )}` +
        `&refresh_token=${record.refreshToken.value}`;
      const tokenResp = await kintone.proxy(
        "https://accounts.secure.freee.co.jp/public_api/token",
        "POST",
        header,
        body
      );
      await saveCredentials(record, JSON.parse(tokenResp[0]));
      alert("アクセストークンを更新しました");
    } else if (code) {
      const state = queryParams.get("state");
      if (state !== record.state.value) {
        alert("freeeの認証情報取得に失敗しました");
        return;
      }
      // freee の認可コード付きで開かれた場合のみ処理する
      const header = {
        "Content-Type": "application/x-www-form-urlencoded",
      };
      const body =
        "grant_type=authorization_code" +
        `&client_id=${record.clientId.value}` +
        `&client_secret=${record.clientSecret.value}` +
        `&redirect_uri=${encodeURIComponent(
          `https://${location.host}/k/${kintone.app.getId()}/`
        )}` +
        `&code=${code}`;

      const tokenResp = await kintone.proxy(
        "https://accounts.secure.freee.co.jp/public_api/token",
        "POST",
        header,
        body
      );
      // tokenResp[0]: body
      // tokenResp[1]: status
      // tokenResp[2]: headers

      // TODO: status チェック

      console.log(tokenResp);
      const credentials = JSON.parse(tokenResp[0]);
      saveCredentials(record, credentials);
      alert("認証に成功しました");
    } else {
      // 認証情報を使ってAPIを呼び出す
      const header = {
        Authorization: "Bearer " + record.accessToken.value,
      };

      const fetchCompaniesResp = await kintone.proxy(
        "https://api.freee.co.jp/api/1/companies",
        "GET",
        header,
        {}
      );

      if (fetchCompaniesResp[1] !== 200 && fetchCompaniesResp[1] !== 201) {
        console.log(fetchCompaniesResp);
        alert("APIの呼び出しが失敗しました");
        return;
      }
      const result = JSON.parse(fetchCompaniesResp[0]);
      console.log(result);
      alert("取得した事業所名\n" + result.companies[0].display_name);
      return "success";
    }
  });
})();
